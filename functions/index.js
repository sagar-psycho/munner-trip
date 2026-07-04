const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.sendNotification = functions.region("us-central1").https.onRequest(async (req, res) => {
  try {
    const { title, message, receiverIds = [], data = {} } = req.body;
    if (!title || !message || !receiverIds.length) {
      res.status(400).send({ error: "Missing title, message, or receiverIds" });
      return;
    }

    const tokensSnap = await admin.firestore().collection("notificationTokens").where("uid", "in", receiverIds).get();
    const tokens = tokensSnap.docs.map((doc) => doc.data().token).filter(Boolean);

    if (!tokens.length) {
      res.send({ success: true, sent: 0 });
      return;
    }

    const payload = {
      notification: { title, body: message },
      data: {
        ...data,
        click_action: "FLUTTER_NOTIFICATION_CLICK"
      },
      android: {
        priority: "high",
        notification: {
          channel_id: "munner_trip_channel",
          sound: "default"
        }
      },
      apns: {
        headers: { "apns-priority": "10" }
      }
    };

    await admin.messaging().sendEachForMulticast({ tokens, data: payload.data, notification: payload.notification, android: payload.android, apns: payload.apns });
    res.send({ success: true, sent: tokens.length });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: error.message });
  }
});
