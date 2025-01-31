function showPopover() {
    const login='stas';
    const password = '123456';
    const popover = document.getElementById('popover');
    popover.style.display = 'block';
    setTimeout(() => {
        popover.style.display = 'none';
    }, 2000); // Hide popover after 2 seconds
}
