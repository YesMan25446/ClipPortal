// Minimal client-side behavior: accessibility tweaks, simple validation, and UX niceties
(function () {
  const $ = (sel) => document.querySelector(sel);
  const form = $('#clipForm');
  const title = $('#title');
  const url = $('#url');
  const file = $('#file');
  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();

  function setError(input, msg) {
    const small = document.querySelector(`small.error[data-for="${input.id}"]`);
    if (small) small.textContent = msg || '';
  }

  function validURL(value) {
    if (!value) return true; // optional
    try {
      const u = new URL(value);
      return !!u.protocol && !!u.host;
    } catch (_) {
      return false;
    }
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;

    // Reset errors
    ['title','url','file','description'].forEach(id => setError({ id }, ''));

    if (!title.value.trim()) {
      setError(title, 'Title is required.');
      ok = false;
    }

    if (url.value && !validURL(url.value)) {
      setError(url, 'Please enter a valid URL.');
      ok = false;
    }

    if (!url.value && !file.files?.length) {
      setError(file, 'Provide a URL or upload a file.');
      ok = false;
    }

    if (!ok) return;

    // Prototype behavior: just show a friendly message
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    // Remove file object from preview output
    if (payload.file instanceof File) payload.file = payload.file.name;

    alert('Submission captured (prototype)\n\n' + JSON.stringify(payload, null, 2));
    form.reset();
  });
})();
