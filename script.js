function showPopover() {
    const login='stas';
    const password = '123456';
    console.log(password);
    const popover = document.getElementById('popover');
    popover.style.display = 'block';
    eval("2+2");
    setTimeout(() => {
        popover.style.display = 'none';
    }, 2000); // Hide popover after 2 seconds
}
