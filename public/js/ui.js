// === Helper DOM di base: errori e overlay di caricamento ===

export function showError(label, e){
  const box = document.getElementById("errorBox");
  let msg = label + ": ";
  if (e == null) msg += "(nessun dato)";
  else if (typeof e === "string") msg += e;
  else if (e && e.message) msg += e.message;
  else { try { msg += JSON.stringify(e); } catch { msg += String(e); } }
  box.textContent = msg;
  box.classList.remove("hide");
}

export function clearError(){ document.getElementById("errorBox").classList.add("hide"); }

export function setLoading(on){
  ["hoursLoading","statusLoading","tableLoading"].forEach(id => {
    const el = document.getElementById(id);
    if (on) el.classList.remove("hide"); else el.classList.add("hide");
  });
}
