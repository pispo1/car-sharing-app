const registerTrip = async () => {
    const week = document.getElementById("week").value;
    const day = document.getElementById("day").value;
    const name = document.getElementById("name").value;
    const role = document.getElementById("role").value;

    if (!week || !day || !name || !role) {
        alert("All fields are required");
        return;
    }

    try {
        const response = await fetch("https://your-firebase-cloud-function-url/registerTrip", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ week, day, name, role })
        });
        const result = await response.json();
        alert(result.message);
        loadTrips();
    } catch (error) {
        console.error("Error registering trip:", error);
    }
};

const loadTrips = async () => {
    const week = document.getElementById("week").value;
    if (!week) return;

    try {
        const response = await fetch("https://your-firebase-cloud-function-url/getTripsByWeek", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ week })
        });
        const trips = await response.json();
        document.getElementById("trips").innerText = JSON.stringify(trips, null, 2);
    } catch (error) {
        console.error("Error loading trips:", error);
    }
};