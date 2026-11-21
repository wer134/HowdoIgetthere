document.addEventListener('click', event => {
  const button = event.target.closest?.('#newTravel');
  if (!button || button.onclick) return;
  const dialog = document.getElementById('travelDialog');
  if (dialog && !dialog.open) dialog.showModal();
});
