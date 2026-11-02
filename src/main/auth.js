// Microsoft account -> Xbox Live -> Minecraft sign-in.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REDIRECT_URI = "http://localhost";
const AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPE = "XboxLive.signin offline_access";
const LOGIN_PARTITION = "persist:microsoft-login";

class AuthError extends Error {}

const XSTS_ERRORS = {
  2148916233: "This Microsoft account has no Xbox profile. Sign in once at minecraft.net, then try again.",
  2148916235: "Xbox Live is not available in your country.",
  2148916236: "This account needs adult verification on xbox.com.",
  2148916237: "This account needs adult verification on xbox.com.",
  2148916238: "This is a child account. An adult has to add it to a Microsoft family first.",
};

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { status: res.status, ok: res.ok, data };
}

async function msToken(clientId, params) {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new AuthError(`Microsoft sign-in failed: ${data.error_description || data.error}`);
  return data;
}

// Opens a Microsoft sign-in window and returns the authorization code.
function promptForCode(BrowserWindow, session, clientId, parent) {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const url = `${AUTHORITY}/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    prompt: "select_account",
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 500,
      height: 650,
      parent,
      modal: !!parent,
      title: "Sign in with Microsoft",
      autoHideMenuBar: true,
      webPreferences: { session: session.fromPartition(LOGIN_PARTITION) },
    });
    let settled = false;
    const finish = (err, code) => {
      if (settled) return;
      settled = true;
      if (!win.isDestroyed()) win.close();
      err ? reject(err) : resolve({ code, verifier });
    };
    const check = (event, target) => {
      if (!target.startsWith(REDIRECT_URI)) return;
      event.preventDefault();
      const params = new URL(target).searchParams;
      if (params.get("code")) finish(null, params.get("code"));
      else finish(new AuthError(params.get("error_description") || "Sign-in was cancelled."));
    };
    win.webContents.on("will-redirect", check);
    win.webContents.on("will-navigate", check);
    win.on("closed", () => finish(new AuthError("Sign-in was cancelled.")));
    win.loadURL(url);
  });
}

// Exchanges a Microsoft access token for a Minecraft session.
async function minecraftLogin(msAccessToken) {
  const xbl = await postJson("https://user.auth.xboxlive.com/user/authenticate", {
    Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${msAccessToken}` },
    RelyingParty: "http://auth.xboxlive.com",
    TokenType: "JWT",
  });
  if (!xbl.ok) throw new AuthError(`Xbox Live sign-in failed (${xbl.status}).`);

  const xsts = await postJson("https://xsts.auth.xboxlive.com/xsts/authorize", {
    Properties: { SandboxId: "RETAIL", UserTokens: [xbl.data.Token] },
    RelyingParty: "rp://api.minecraftservices.com/",
    TokenType: "JWT",
  });
  if (!xsts.ok) throw new AuthError(XSTS_ERRORS[xsts.data.XErr] || `Xbox Live authorization failed (${xsts.status}).`);
  const uhs = xsts.data.DisplayClaims.xui[0].uhs;

  const mc = await postJson("https://api.minecraftservices.com/authentication/login_with_xbox", {
    identityToken: `XBL3.0 x=${uhs};${xsts.data.Token}`,
  });
  if (mc.status === 403) {
    throw new AuthError("Minecraft refused this launcher. Mojang hasn't approved the app registration yet.");
  }
  if (!mc.ok) throw new AuthError(`Minecraft sign-in failed (${mc.status}).`);

  const profileRes = await fetch("https://api.minecraftservices.com/minecraft/profile", {
    headers: { Authorization: `Bearer ${mc.data.access_token}` },
  });
  if (profileRes.status === 404) throw new AuthError("This Microsoft account doesn't own Minecraft: Java Edition.");
  if (!profileRes.ok) throw new AuthError(`Couldn't load your Minecraft profile (${profileRes.status}).`);
  const profile = await profileRes.json();

  return {
    accessToken: mc.data.access_token,
    expiresAt: Date.now() + mc.data.expires_in * 1000,
    profile: { id: profile.id, name: profile.name },
  };
}

// Keeps the signed-in account, encrypted with Windows' per-user key (safeStorage).
class Account {
  constructor({ file, clientId, safeStorage, BrowserWindow, session }) {
    Object.assign(this, { file, clientId, safeStorage, BrowserWindow, session });
    this.data = this.load();
  }

  load() {
    try {
      return JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file)));
    } catch {
      return null;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, this.safeStorage.encryptString(JSON.stringify(this.data)));
  }

  summary() {
    return this.data ? { name: this.data.profile.name, id: this.data.profile.id } : null;
  }

  async login(parent) {
    if (!this.clientId) throw new AuthError("The launcher has no Microsoft client ID set yet.");
    const { code, verifier } = await promptForCode(this.BrowserWindow, this.session, this.clientId, parent);
    const ms = await msToken(this.clientId, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    this.data = { refreshToken: ms.refresh_token, ...(await minecraftLogin(ms.access_token)) };
    this.save();
    return this.summary();
  }

  // Returns a valid Minecraft session, refreshing it silently when it has expired.
  async getSession() {
    if (!this.data) throw new AuthError("Please sign in first.");
    if (this.data.expiresAt - Date.now() > 5 * 60 * 1000) return this.data;
    const ms = await msToken(this.clientId, { grant_type: "refresh_token", refresh_token: this.data.refreshToken });
    this.data = { refreshToken: ms.refresh_token || this.data.refreshToken, ...(await minecraftLogin(ms.access_token)) };
    this.save();
    return this.data;
  }

  async logout() {
    this.data = null;
    fs.rmSync(this.file, { force: true });
    // Forget the Microsoft cookies too, so the next sign-in can pick a different account.
    await this.session.fromPartition(LOGIN_PARTITION).clearStorageData();
  }
}

module.exports = { Account, AuthError, minecraftLogin };
