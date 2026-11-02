// Distant Horizons download window: pick a quality, download it, watch the progress.

const dh = { pack: null, status: null, selected: null, downloading: false };

const formatMB = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

function renderDhLevels() {
  const { levels, installed } = dh.status;
  $("dhLevels").replaceChildren(
    ...levels.map((level, i) =>
      el(
        "button",
        {
          className: "dh-level" + (level.id === dh.selected ? " selected" : ""),
          role: "radio",
          ariaChecked: String(level.id === dh.selected),
          disabled: dh.downloading,
          onclick: () => {
            dh.selected = level.id;
            renderDh();
          },
        },
        [
          el("span", { className: "dh-bars" }, [0, 1, 2].map((b) => el("i", { className: b <= (i * 2) / Math.max(1, levels.length - 1) ? "on" : "" }))),
          el("span", { className: "dh-name", textContent: level.label }),
          el("span", { className: "dh-desc", textContent: level.description || "" }),
          el("span", { className: "dh-size", textContent: level.size ? formatMB(level.size) : "" }),
          ...(level.id === installed ? [el("span", { className: "dh-installed", textContent: "Installed" })] : []),
        ]
      )
    )
  );
}

function renderDh() {
  renderDhLevels();
  const isInstalled = dh.selected === dh.status.installed;
  const btn = $("dhDownloadBtn");
  btn.disabled = dh.downloading || !dh.selected;
  btn.textContent = dh.downloading ? "Downloading…" : isInstalled ? "Download again" : dh.status.installed ? "Switch quality" : "Download";
}

function setDhProgress(done, total) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  $("dhProgress").classList.remove("hidden");
  $("dhProgressLabel").textContent = total ? `${formatMB(done)} of ${formatMB(total)}` : "Starting download…";
  $("dhProgressPct").textContent = `${pct}%`;
  $("dhProgressFill").style.width = `${pct}%`;
}

async function openDistantHorizons(pack) {
  dh.pack = pack;
  dh.status = await api.dhStatus(pack.id);
  // Default to what's installed, otherwise the middle option.
  dh.selected = dh.status.installed || dh.status.levels[Math.floor((dh.status.levels.length - 1) / 2)]?.id || null;
  if (!dh.downloading) $("dhProgress").classList.add("hidden");
  renderDh();
  $("dhOverlay").classList.remove("hidden");
}

function wireDh() {
  api.onDhProgress(({ done, total }) => setDhProgress(done, total));

  $("dhFolderBtn").onclick = () => api.openFolder(dh.pack.id, "Distant_Horizons_server_data").catch((e) => toast(e.message, true));

  $("dhDownloadBtn").onclick = async () => {
    const level = dh.status.levels.find((l) => l.id === dh.selected);
    dh.downloading = true;
    setDhProgress(0, 0);
    renderDh();
    try {
      dh.status = await api.dhDownload(dh.pack.id, dh.selected);
      $("dhProgressLabel").textContent = "Done";
      toast(`Distant Horizons ${level.label} terrain is installed. It shows up next time you join the server.`);
    } catch (e) {
      $("dhProgress").classList.add("hidden");
      toast(e.message, true);
    } finally {
      dh.downloading = false;
      renderDh();
    }
  };
}

wireDh();
