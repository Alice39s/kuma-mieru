// custom.js
window.addEventListener('load', () => {
    // 创建一个新的 div
    const topLink = document.createElement('div');
    topLink.style.textAlign = 'center';        // 居中
    topLink.style.margin = '10px 0';           // 上下间距
    topLink.style.fontSize = '16px';           // 字体大小
    topLink.style.fontWeight = 'bold';         // 加粗
    topLink.style.color = '#4f46e5';           // 链接颜色，可修改

    // 设置 HTML 内容
    topLink.innerHTML = '<a href="https://bjlglhez.us-west-1.clawcloudrun.com/dashboard" rel="noopener noreferrer">我的uptime-kuma后台</a>';

    // 插入页面顶部
    document.body.prepend(topLink);
});
