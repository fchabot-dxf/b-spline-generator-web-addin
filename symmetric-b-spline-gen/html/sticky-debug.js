window.addEventListener('load', function() {
  const stickyActions = document.querySelector('.sticky-actions');
  if (stickyActions) {
    const style = window.getComputedStyle(stickyActions);
    alert('[DEBUG] .sticky-actions computed style: ' + style.position + ', ' + style.top + ', ' + style.zIndex);
  } else {
    alert('[DEBUG] .sticky-actions element not found');
  }
});