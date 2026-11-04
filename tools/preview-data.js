// Used only by tools/preview.py, outside the Firebase public directory.
const supabaseUrl = "local-demo";
const supabaseKey = "dummy";
const supabase = {
  createClient() {
    const profiles = [
      { email: "you@example.invalid", first_name: "Alex", last_name: "Demo", company: "Empresa A", seats: 5 },
      { email: "maialen@example.invalid", first_name: "Maialen", last_name: "Demo", company: "Empresa A", seats: 5 },
      { email: "jon@example.invalid", first_name: "Jon", last_name: "Demo", company: "Empresa B", seats: 4 },
      { email: "nerea@example.invalid", first_name: "Nerea", last_name: "Demo", company: "Empresa B", seats: 5 },
      { email: "iker@example.invalid", first_name: "Iker", last_name: "Demo", company: null, seats: 5 },
      { email: "ane@example.invalid", first_name: "Ane", last_name: "Demo", company: "Empresa A", seats: 5 },
    ];
    const user = { id: "demo", email: profiles[0].email };
    const weeks = new Map();
    let loggedIn = true;

    function seedWeek(start) {
      if (weeks.has(start)) return weeks.get(start);
      const trips = [];
      // Monday: spare seats; Tuesday: shortage; Wednesday: cross-company seats;
      // Thursday: no driver yet; Friday: no reservations.
      const participants = [[0, 1, 2], [0, 1, 2, 3, 4, 5], [1, 2, 3], [0, 2], []];
      participants.forEach((people, day) => {
        const date = new Date(`${start}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + day);
        people.forEach((person, index) => trips.push({
          trip_date: date.toISOString().slice(0, 10),
          is_driver: day < 3 && index === 0,
          notes: person === 0 ? "Salida a las 8:00" : null,
          profiles: profiles[person],
        }));
      });
      weeks.set(start, trips);
      return trips;
    }

    function stats() {
      const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
      const trips = [...weeks.values()].flat();
      const counts = (rows) => ({
        driver_trips: rows.filter((trip) => trip.is_driver).length,
        passenger_trips: rows.filter((trip) => !trip.is_driver).length,
        driver_ratio: rows.length ? rows.filter((trip) => trip.is_driver).length / rows.length : 0,
      });
      const row = (profile, rows) => {
        const past = counts(rows.filter((trip) => trip.trip_date < today));
        return { ...profile, ...counts(rows), driver_trips_until_today: past.driver_trips,
          passenger_trips_until_today: past.passenger_trips, driver_ratio_until_today: past.driver_ratio };
      };
      return [...profiles.map((profile) => row(profile, trips.filter((trip) => trip.profiles.email === profile.email))),
        row({ email: null, first_name: "TOTAL", last_name: null }, trips)];
    }

    return {
      auth: {
        getSession: async () => ({ data: { session: loggedIn ? { user } : null } }),
        signInWithPassword: async () => { loggedIn = true; return { data: { user }, error: null }; },
        signOut: async () => { loggedIn = false; return { error: null }; },
        resetPasswordForEmail: async () => ({ error: { message: "Demo local: no se envían correos." } }),
      },
      functions: {
        async invoke(path, options = {}) {
          // A short delay makes loading and save feedback visible during preview.
          await new Promise((resolve) => setTimeout(resolve, 200));
          const url = new URL(path, "https://example.invalid/");
          if (url.searchParams.get("stats") === "true") return { data: { stats: stats() }, error: null };
          if (url.searchParams.get("csv") === "true") {
            return { data: "Demo local: exportación simulada\n", error: null };
          }
          if (options.method === "POST" || options.method === "DELETE") {
            const date = options.body?.trip_date || url.pathname.split("/").pop();
            const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
            if (date < today) return { error: { message: "No se pueden modificar días pasados." } };
            const trips = [...weeks.entries()].find(([start]) => {
              const end = new Date(`${start}T12:00:00Z`);
              end.setUTCDate(end.getUTCDate() + 6);
              return date >= start && date <= end.toISOString().slice(0, 10);
            })?.[1];
            if (!trips) return { error: { message: "Semana no cargada." } };
            const index = trips.findIndex((trip) => trip.trip_date === date && trip.profiles.email === user.email);
            if (index !== -1) trips.splice(index, 1);
            if (options.method === "POST") trips.push({ ...options.body, profiles: profiles[0] });
            return { data: {}, error: null };
          }
          const start = url.searchParams.get("start");
          return { data: { trips: seedWeek(start) }, error: null };
        },
      },
    };
  },
};
