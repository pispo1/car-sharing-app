const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

exports.getTripsByWeek = functions.https.onCall(async (data, context) => {
    const { week } = data;
    if (!week) {
        throw new functions.https.HttpsError("invalid-argument", "Week is required");
    }

    const tripDoc = await db.collection("tripsWeek").doc(week).get();
    if (!tripDoc.exists) {
        return { message: "No trips found for this week" };
    }

    return tripDoc.data();
});
