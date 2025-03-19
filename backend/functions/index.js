const functions = require("firebase-functions");
const tripRegistration = require("./tripRegistration");
const tripManagement = require("./tripManagement");

exports.registerTrip = tripRegistration.registerTrip;
exports.getTripsByWeek = tripManagement.getTripsByWeek;
