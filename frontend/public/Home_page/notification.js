// notification.js
// LUNAGS Management System
// 通知共通ライブラリ

export function getUnreadCount(notifications) {
    return notifications.filter(n => n.unread).length;
}

export function markAllAsRead(notifications) {
    return notifications.map(notification => ({
        ...notification,
        unread: false
    }));
}

export function markAsRead(notifications, id) {
    return notifications.map(notification =>
        notification.id === id
            ? { ...notification, unread: false }
            : notification
    );
}

export function sortNotifications(notifications) {
    return [...notifications].sort((a, b) => getTimeValue(b) - getTimeValue(a));
}

export function getTimeValue(item) {
    if (typeof item.createdAtLocal === "number") {
        return item.createdAtLocal;
    }

    if (item.createdAt?.toMillis) {
        return item.createdAt.toMillis();
    }

    return 0;
}

export function formatRelativeTime(item) {
    const value = getTimeValue(item);

    if (!value) return item.time || "";

    const diff = Math.max(
        1,
        Math.floor((Date.now() - value) / 60000)
    );

    if (diff < 60) {
        return `${diff}分前`;
    }

    if (diff < 1440) {
        return `${Math.floor(diff / 60)}時間前`;
    }

    return `${Math.floor(diff / 1440)}日前`;
}

export function createNotificationHTML(notifications, escapeHtml) {

    if (!notifications.length) {
        return `
            <div class="notif__empty">
                通知はまだありません。
            </div>
        `;
    }

    return notifications.map(item => `
        <div
            class="notif__item ${item.unread ? "is-unread" : ""}"
            data-id="${item.id}"
        >
            <span class="notif__dot"></span>

            <div class="notif__content">

                <div class="notif__item-text">
                    ${escapeHtml(item.text || "")}
                </div>

                <div class="notif__item-time">
                    ${escapeHtml(formatRelativeTime(item))}
                </div>

            </div>

        </div>
    `).join("");

}

export function showToast(text) {

    const stack = document.getElementById("toastStack");

    if (!stack) return;

    const toast = document.createElement("div");

    toast.className = "toast";
    toast.textContent = text;

    stack.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add("is-visible");
    });

    setTimeout(() => {

        toast.classList.remove("is-visible");

        setTimeout(() => {
            toast.remove();
        }, 200);

    }, 4000);

}