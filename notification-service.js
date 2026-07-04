// notification-service.js
// Central notification engine for Munner Trip.
// Every feature module should call NotificationService.send(...)
// instead of implementing notification logic itself.

import { db, COLLECTIONS } from "./firebase-config.js";
import { currentUser, currentProfile } from "./auth.js";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const NOTIFICATION_TYPES = {
  PLANNER_CREATED: "planner_created",
  PLANNER_UPDATED: "planner_updated",
  PLANNER_DELETED: "planner_deleted",
  PLANNER_REMINDER: "planner_reminder",
  PLANNER_COMPLETED: "planner_completed",
  EXPENSE_SUBMITTED: "expense_submitted",
  EXPENSE_APPROVED: "expense_approved",
  EXPENSE_REJECTED: "expense_rejected",
  EXPENSE_COMMENT_ADDED: "expense_comment_added",
  SETTLEMENT_CREATED: "settlement_created",
  SETTLEMENT_COMPLETED: "settlement_completed",
  PAYMENT_ADDED: "payment_added",
  PAYMENT_CONFIRMED: "payment_confirmed",
  PAYMENT_FAILED: "payment_failed",
  MEMBER_ADDED: "member_added",
  MEMBER_UPDATED: "member_updated",
  MEMBER_JOINED: "member_joined",
  MEMBER_REMOVED: "member_removed",
  ROLE_CHANGED: "role_changed",
  TRIP_CREATED: "trip_created",
  TRIP_UPDATED: "trip_updated",
  TRIP_ARCHIVED: "trip_archived",
  TRIP_STARTED: "trip_started",
  TRIP_ENDING_TOMORROW: "trip_ending_tomorrow",
  TRIP_COMPLETED: "trip_completed",
  IMAGES_UPLOADED: "images_uploaded",
  VIDEOS_UPLOADED: "videos_uploaded",
  DOCUMENTS_UPLOADED: "documents_uploaded",
  ANNOUNCEMENT: "announcement",
  EMERGENCY_ANNOUNCEMENT: "emergency_announcement",
  CHAT_MESSAGE: "chat_message",
  CHAT_REPLY: "chat_reply",
  CHAT_MENTION: "chat_mention",
  CHAT_REACTION: "chat_reaction",
  VOICE_NOTE: "voice_note",
  SYSTEM_ALERT: "system_alert",
  SECURITY_ALERT: "security_alert"
};

export const NOTIFICATION_CATEGORIES = {
  PLANNER: "Planner",
  EXPENSES: "Expenses",
  PAYMENTS: "Payments",
  MEDIA: "Media",
  CHAT: "Chat",
  MEMBERS: "Members",
  TRIPS: "Trips",
  ANNOUNCEMENTS: "Announcements",
  SYSTEM: "System"
};

export const NOTIFICATION_SOUND_TYPES = {
  CHAT: "chat",
  PLANNER: "planner",
  EMERGENCY: "emergency"
};

export const NOTIFICATION_CHANNELS = {
  FIRESTORE: "firestore",
  FCM: "fcm",
  BROWSER: "browser"
};

const DEFAULT_PAGE_SIZE = 12;

function deriveCategory(type) {
  switch (type) {
    case NOTIFICATION_TYPES.PLANNER_CREATED:
    case NOTIFICATION_TYPES.PLANNER_UPDATED:
    case NOTIFICATION_TYPES.PLANNER_DELETED:
    case NOTIFICATION_TYPES.PLANNER_REMINDER:
    case NOTIFICATION_TYPES.PLANNER_COMPLETED:
      return NOTIFICATION_CATEGORIES.PLANNER;
    case NOTIFICATION_TYPES.EXPENSE_SUBMITTED:
    case NOTIFICATION_TYPES.EXPENSE_APPROVED:
    case NOTIFICATION_TYPES.EXPENSE_REJECTED:
    case NOTIFICATION_TYPES.EXPENSE_COMMENT_ADDED:
      return NOTIFICATION_CATEGORIES.EXPENSES;
    case NOTIFICATION_TYPES.SETTLEMENT_CREATED:
    case NOTIFICATION_TYPES.SETTLEMENT_COMPLETED:
    case NOTIFICATION_TYPES.PAYMENT_ADDED:
    case NOTIFICATION_TYPES.PAYMENT_CONFIRMED:
    case NOTIFICATION_TYPES.PAYMENT_FAILED:
      return NOTIFICATION_CATEGORIES.PAYMENTS;
    case NOTIFICATION_TYPES.IMAGES_UPLOADED:
    case NOTIFICATION_TYPES.VIDEOS_UPLOADED:
    case NOTIFICATION_TYPES.DOCUMENTS_UPLOADED:
      return NOTIFICATION_CATEGORIES.MEDIA;
    case NOTIFICATION_TYPES.CHAT_MESSAGE:
    case NOTIFICATION_TYPES.CHAT_REPLY:
    case NOTIFICATION_TYPES.CHAT_MENTION:
    case NOTIFICATION_TYPES.CHAT_REACTION:
    case NOTIFICATION_TYPES.VOICE_NOTE:
      return NOTIFICATION_CATEGORIES.CHAT;
    case NOTIFICATION_TYPES.MEMBER_ADDED:
    case NOTIFICATION_TYPES.MEMBER_UPDATED:
    case NOTIFICATION_TYPES.MEMBER_JOINED:
    case NOTIFICATION_TYPES.MEMBER_REMOVED:
    case NOTIFICATION_TYPES.ROLE_CHANGED:
      return NOTIFICATION_CATEGORIES.MEMBERS;
    case NOTIFICATION_TYPES.TRIP_CREATED:
    case NOTIFICATION_TYPES.TRIP_UPDATED:
    case NOTIFICATION_TYPES.TRIP_ARCHIVED:
    case NOTIFICATION_TYPES.TRIP_STARTED:
    case NOTIFICATION_TYPES.TRIP_ENDING_TOMORROW:
    case NOTIFICATION_TYPES.TRIP_COMPLETED:
      return NOTIFICATION_CATEGORIES.TRIPS;
    case NOTIFICATION_TYPES.ANNOUNCEMENT:
    case NOTIFICATION_TYPES.EMERGENCY_ANNOUNCEMENT:
      return NOTIFICATION_CATEGORIES.ANNOUNCEMENTS;
    case NOTIFICATION_TYPES.SYSTEM_ALERT:
    case NOTIFICATION_TYPES.SECURITY_ALERT:
      return NOTIFICATION_CATEGORIES.SYSTEM;
    default:
      return NOTIFICATION_CATEGORIES.SYSTEM;
  }
}

function deriveSound(type) {
  if (type === NOTIFICATION_TYPES.CHAT_MESSAGE || type === NOTIFICATION_TYPES.CHAT_REPLY || type === NOTIFICATION_TYPES.CHAT_MENTION) {
    return NOTIFICATION_SOUND_TYPES.CHAT;
  }
  if (type === NOTIFICATION_TYPES.EMERGENCY_ANNOUNCEMENT || type === NOTIFICATION_TYPES.SECURITY_ALERT) {
    return NOTIFICATION_SOUND_TYPES.EMERGENCY;
  }
  if (type === NOTIFICATION_TYPES.PLANNER_CREATED || type === NOTIFICATION_TYPES.PLANNER_UPDATED || type === NOTIFICATION_TYPES.PLANNER_REMINDER) {
    return NOTIFICATION_SOUND_TYPES.PLANNER;
  }
  return null;
}

function deriveTargetTab(type) {
  if (type === NOTIFICATION_TYPES.CHAT_MESSAGE || type === NOTIFICATION_TYPES.CHAT_REPLY || type === NOTIFICATION_TYPES.CHAT_MENTION || type === NOTIFICATION_TYPES.CHAT_REACTION || type === NOTIFICATION_TYPES.VOICE_NOTE) {
    return "chat";
  }
  if (type === NOTIFICATION_TYPES.IMAGES_UPLOADED || type === NOTIFICATION_TYPES.VIDEOS_UPLOADED || type === NOTIFICATION_TYPES.DOCUMENTS_UPLOADED) {
    return "media";
  }
  if (type === NOTIFICATION_TYPES.EXPENSE_SUBMITTED || type === NOTIFICATION_TYPES.EXPENSE_APPROVED || type === NOTIFICATION_TYPES.EXPENSE_REJECTED || type === NOTIFICATION_TYPES.EXPENSE_COMMENT_ADDED || type === NOTIFICATION_TYPES.PAYMENT_ADDED || type === NOTIFICATION_TYPES.PAYMENT_CONFIRMED || type === NOTIFICATION_TYPES.PAYMENT_FAILED || type === NOTIFICATION_TYPES.SETTLEMENT_CREATED || type === NOTIFICATION_TYPES.SETTLEMENT_COMPLETED) {
    return "expenses";
  }
  if (type === NOTIFICATION_TYPES.PLANNER_CREATED || type === NOTIFICATION_TYPES.PLANNER_UPDATED || type === NOTIFICATION_TYPES.PLANNER_DELETED || type === NOTIFICATION_TYPES.PLANNER_REMINDER || type === NOTIFICATION_TYPES.PLANNER_COMPLETED) {
    return "planner";
  }
  if (type === NOTIFICATION_TYPES.MEMBER_ADDED || type === NOTIFICATION_TYPES.MEMBER_UPDATED || type === NOTIFICATION_TYPES.MEMBER_JOINED || type === NOTIFICATION_TYPES.MEMBER_REMOVED || type === NOTIFICATION_TYPES.ROLE_CHANGED) {
    return "admin";
  }
  return "notifications";
}

function getUserState(notification, uid) {
  return notification?.userState?.[uid] || { isRead: false, isArchived: false, isDeleted: false };
}

function isVisibleToUser(notification, uid) {
  const state = getUserState(notification, uid);
  return !state.isDeleted;
}

function getCreatedAtValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return Number(value) || 0;
}

export const NotificationService = {
  async send({
    type,
    title,
    message,
    senderId = currentUser?.uid || null,
    senderName = currentProfile?.name || "System",
    receiverIds = [],
    tripId = null,
    expenseId = null,
    mediaId = null,
    chatId = null,
    priority = "normal",
    channels = [NOTIFICATION_CHANNELS.FIRESTORE, NOTIFICATION_CHANNELS.BROWSER],
    dedupeKey = null,
    metadata = {},
    category = null,
    targetType = null,
    targetId = null,
    deepLink = null,
    sound = null,
    groupKey = null,
    excludeSender = true
  }) {
    if (!type || !title || !message) {
      throw new Error("Notification requires type, title, and message.");
    }

    if (!senderId && type !== NOTIFICATION_TYPES.TRIP_STARTED_REMINDER) {
      throw new Error("Sender is required for notifications.");
    }

    if (senderId && currentUser?.uid && senderId !== currentUser.uid) {
      throw new Error("You can only send notifications from your own account.");
    }

    const resolvedReceiverIds = await this._resolveReceiverIds({ receiverIds, senderId, excludeSender });
    if (!resolvedReceiverIds.length) {
      return { sent: 0, skipped: 0, duplicate: true };
    }

    const dedupeValue = dedupeKey || metadata.dedupeKey || `${type}:${resolvedReceiverIds.join("-")}:${targetType || "global"}:${targetId || ""}:${message}`;
    const existing = await this._findRecentDuplicate(dedupeValue);
    if (existing) {
      return { sent: 0, skipped: 1, duplicate: true };
    }

    const actualCategory = category || deriveCategory(type);
    const actualTargetType = targetType || deriveTargetTab(type);
    const actualDeepLink = deepLink || `#${actualTargetType}`;
    const actualSound = sound || deriveSound(type);
    const actualGroupKey = groupKey || `${type}:${senderId || "system"}:${targetType || actualTargetType}:${targetId || "global"}`;

    const batch = writeBatch(db);
    const notificationRef = doc(collection(db, COLLECTIONS.NOTIFICATIONS));
    const now = serverTimestamp();
    const userState = {};

    resolvedReceiverIds.forEach((receiverId) => {
      userState[receiverId] = {
        isRead: false,
        isArchived: false,
        isDeleted: false,
        createdAt: now,
        updatedAt: now
      };
    });

    batch.set(notificationRef, {
      notificationId: notificationRef.id,
      title,
      message,
      type,
      category: actualCategory,
      senderId,
      senderName,
      receiverIds: resolvedReceiverIds,
      tripId,
      expenseId,
      mediaId,
      chatId,
      targetType: actualTargetType,
      targetId,
      deepLink: actualDeepLink,
      priority,
      createdAt: now,
      updatedAt: now,
      isRead: false,
      isArchived: false,
      isDeleted: false,
      clicked: false,
      dedupeKey: dedupeValue,
      groupKey: actualGroupKey,
      groupCount: 1,
      sound: actualSound,
      userState,
      metadata: { ...metadata, dedupeKey: dedupeValue }
    });

    resolvedReceiverIds.forEach((receiverId) => {
      const tokenRef = doc(collection(db, COLLECTIONS.NOTIFICATION_TOKENS), receiverId);
      batch.set(tokenRef, { uid: receiverId, updatedAt: now }, { merge: true });
    });

    await batch.commit();

    if (channels.includes(NOTIFICATION_CHANNELS.BROWSER)) {
      this._showBrowserNotification({ title, body: message, data: { type, chatId, tripId, expenseId, mediaId, deepLink: actualDeepLink, targetType: actualTargetType, targetId } });
    }

    if (channels.includes(NOTIFICATION_CHANNELS.FCM)) {
      await this._sendFCMToReceivers({ title, message, receiverIds: resolvedReceiverIds, data: { type, chatId, tripId, expenseId, mediaId, deepLink: actualDeepLink, targetType: actualTargetType, targetId } });
    }

    if (actualSound) {
      this._playSound(actualSound);
    }

    return { sent: resolvedReceiverIds.length, skipped: 0, duplicate: false };
  },

  async sendToEveryone({ type, title, message, tripId = null, mediaId = null, chatId = null, priority = "normal", metadata = {}, groupKey = null }) {
    const membersSnap = await getDocs(collection(db, COLLECTIONS.MEMBERS));
    const receiverIds = membersSnap.docs.map((docSnap) => docSnap.id).filter((uid) => uid !== currentUser?.uid);
    return this.send({
      type,
      title,
      message,
      receiverIds,
      tripId,
      mediaId,
      chatId,
      priority,
      metadata,
      groupKey,
      dedupeKey: `${type}:${tripId || "global"}`
    });
  },

  subscribeToNotifications(uid, callback, { limitCount = DEFAULT_PAGE_SIZE } = {}) {
    const q = query(collection(db, COLLECTIONS.NOTIFICATIONS), where("receiverIds", "array-contains", uid), limit(limitCount));
    return onSnapshot(q, (snap) => {
      const notifications = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((item) => isVisibleToUser(item, uid))
        .sort((a, b) => getCreatedAtValue(b.createdAt) - getCreatedAtValue(a.createdAt));
      callback(notifications);
    });
  },

  subscribeUnreadCount(uid, callback) {
    return this.subscribeToNotifications(uid, (notifications) => {
      const count = notifications.filter((item) => !getUserState(item, uid).isRead).length;
      callback(count);
    });
  },

  async markRead(notificationId) {
    if (!currentUser?.uid) return;
    await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, notificationId), {
      [`userState.${currentUser.uid}.isRead`]: true,
      [`userState.${currentUser.uid}.readAt`]: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  },

  async markAllRead(uid) {
    const q = query(collection(db, COLLECTIONS.NOTIFICATIONS), where("receiverIds", "array-contains", uid));
    const snaps = await getDocs(q);
    const batch = writeBatch(db);
    snaps.forEach((snap) => {
      const data = snap.data();
      const state = getUserState(data, uid);
      if (!state.isRead) {
        batch.update(doc(db, COLLECTIONS.NOTIFICATIONS, snap.id), {
          [`userState.${uid}.isRead`]: true,
          [`userState.${uid}.readAt`]: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    });
    await batch.commit();
  },

  async archiveNotification(notificationId) {
    if (!currentUser?.uid) return;
    await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, notificationId), {
      [`userState.${currentUser.uid}.isArchived`]: true,
      [`userState.${currentUser.uid}.archivedAt`]: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  },

  async unarchiveNotification(notificationId) {
    if (!currentUser?.uid) return;
    await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, notificationId), {
      [`userState.${currentUser.uid}.isArchived`]: false,
      updatedAt: serverTimestamp()
    });
  },

  async deleteNotification(notificationId) {
    if (!currentUser?.uid) return;
    await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, notificationId), {
      [`userState.${currentUser.uid}.isDeleted`]: true,
      [`userState.${currentUser.uid}.deletedAt`]: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  },

  async undoDeleteNotification(notificationId) {
    if (!currentUser?.uid) return;
    await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, notificationId), {
      [`userState.${currentUser.uid}.isDeleted`]: false,
      updatedAt: serverTimestamp()
    });
  },

  _showBrowserNotification({ title, body, data }) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const notification = new Notification(title, {
      body,
      icon: "https://sagar-psycho.github.io/munner-trip/favicon.ico",
      tag: data?.type || "munner-trip",
      data
    });

    notification.onclick = () => {
      window.focus();
      if (data?.deepLink) {
        window.location.hash = data.deepLink.replace(/^#/, "");
      } else {
        window.location.hash = "notifications";
      }
    };
  },

  _playSound(soundType) {
    if (!soundType || typeof window === "undefined") return;
    try {
      const context = window.AudioContext || window.webkitAudioContext;
      if (!context) return;
      const audioContext = new context();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      let frequency = 880;
      let duration = 0.12;
      if (soundType === NOTIFICATION_SOUND_TYPES.CHAT) {
        frequency = 660;
        duration = 0.08;
      } else if (soundType === NOTIFICATION_SOUND_TYPES.EMERGENCY) {
        frequency = 220;
        duration = 0.24;
      }

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gainNode.gain.value = 0.04;
      oscillator.start();
      setTimeout(() => {
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.03);
        oscillator.stop(audioContext.currentTime + 0.03);
        audioContext.close();
      }, duration * 1000);
    } catch (err) {
      console.warn("Unable to play notification sound", err);
    }
  },

  async _sendFCMToReceivers({ title, message, receiverIds, data }) {
    const functionUrl = "https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/sendNotification";
    await fetch(functionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, message, receiverIds, data })
    });
  },

  async _findRecentDuplicate(dedupeKey) {
    const q = query(collection(db, COLLECTIONS.NOTIFICATIONS), where("dedupeKey", "==", dedupeKey));
    const snaps = await getDocs(q);
    return snaps.docs[0] || null;
  },

  async _resolveReceiverIds({ receiverIds = [], senderId = currentUser?.uid || null, excludeSender = true }) {
    const normalizedReceiverIds = Array.from(new Set((receiverIds || []).filter(Boolean)));
    if (normalizedReceiverIds.length) {
      return excludeSender && senderId
        ? normalizedReceiverIds.filter((id) => id !== senderId)
        : normalizedReceiverIds;
    }

    const membersSnap = await getDocs(collection(db, COLLECTIONS.MEMBERS));
    const memberIds = membersSnap.docs.map((docSnap) => docSnap.id).filter(Boolean);
    if (!memberIds.length) return [];
    return excludeSender && senderId
      ? memberIds.filter((id) => id !== senderId)
      : memberIds;
  }
};

export async function requestBrowserNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") {
    localStorage.setItem("munner-trip-notification-permission", "granted");
    return true;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    localStorage.setItem("munner-trip-notification-permission", "granted");
  }
  return permission === "granted";
}

export async function registerFCMToken(token) {
  if (!currentUser?.uid || !token) return;
  const ref = doc(db, COLLECTIONS.NOTIFICATION_TOKENS, currentUser.uid);
  await setDoc(ref, {
    uid: currentUser.uid,
    token,
    updatedAt: serverTimestamp()
  }, { merge: true });
}
