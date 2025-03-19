const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

exports.registerTrip = functions.https.onCall(async (data, context) => {
    const { week, day, name, role } = data;
    if (!week || !day || !name || !role) {
        throw new functions.https.HttpsError("invalid-argument", "Missing fields");
    }

    const tripRef = db.collection("tripsWeek").doc(week);
    await tripRef.set({
        [day]: admin.firestore.FieldValue.arrayUnion({ name, role })
    }, { merge: true });

    return { message: "Trip registered successfully" };
});
