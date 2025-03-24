import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
import { format, getWeek, startOfWeek } from 'https://cdn.skypack.dev/date-fns';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Content-Type': 'application/json'
};

const supabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

async function getTrips(start?: string, end?: string) {
  try {
    let query = supabaseClient.from('trips')
      .select('trip_date, is_driver, notes, profiles(email, first_name, last_name, seats)');

    if (start) query = query.gte('trip_date', start);
    if (end) query = query.lte('trip_date', end);

    const { data, error } = await query;
    if (error) throw error;

    return new Response(JSON.stringify({ trips: data }), { headers: corsHeaders, status: 200 });
  } catch (error) {
    console.error('Error fetching trips:', error);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
}

async function getTripsCSV(start?: string, end?: string) {
  try {
    let query = supabaseClient.from('trips')
      .select('trip_date, is_driver, notes, profiles(email, first_name, last_name)');

    if (start) query = query.gte('trip_date', start);
    if (end) query = query.lte('trip_date', end);

    const { data, error } = await query;
    if (error) throw error;

    let csvContent = "Week,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday\n";

    const groupedByWeek: { [key: string]: any } = {};
    data?.forEach((trip: any) => {
      const tripDate = new Date(trip.trip_date);
      const weekNumber = getWeek(tripDate);
      const startOfThisWeek = startOfWeek(tripDate, { weekStartsOn: 1 });

      const formattedDate = format(startOfThisWeek, 'yyyy-MM-dd');
      if (!groupedByWeek[weekNumber]) {
        groupedByWeek[weekNumber] = {};
      }

      const dayOfWeek = format(tripDate, 'EEEE');
      if (!groupedByWeek[weekNumber][dayOfWeek]) {
        groupedByWeek[weekNumber][dayOfWeek] = [];
      }

      const passengerOrDriver = trip.is_driver ? 'Driver' : 'Passenger';
      groupedByWeek[weekNumber][dayOfWeek].push(`${trip.profiles.first_name}${trip.profiles.last_name ? " " + trip.profiles.last_name +" ": " "}[${passengerOrDriver}]${trip.notes ? "(" + trip.notes + ")" : ""}`);
    });

    Object.keys(groupedByWeek).forEach((week) => {
      let row = `${week}`;
      for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
        const dayData = groupedByWeek[week][day]?.join('/ ') || '';
        row += `,${dayData}`;
      }
      csvContent += `${row}\n`;
    });

    return new Response(csvContent, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="trips.csv"',
      },
      status: 200,
    });

  } catch (error) {
    console.error('Error fetching trips:', error);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
}

async function getTripsStats() {
  try {
    const { data, error } = await supabaseClient.rpc('get_trip_ratios');
    if (error) throw error;
    return new Response(JSON.stringify({ stats: data }), { headers: corsHeaders, status: 200 });
  } catch (error) {
    console.error('Error fetching trip stats:', error);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
}

function getCurrentDateInMadrid(): string {
  const currentDate = new Date().toLocaleString('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const [day, month, year] = currentDate.split('/');
  return `${year}-${month}-${day}`; 
}


async function createTrip(user_id: string, trip: any) {
  try {
    const { trip_date, is_driver, notes } = trip;

    const formattedCurrentDate = getCurrentDateInMadrid();

    if (trip_date < formattedCurrentDate) {
      return new Response(JSON.stringify({ error: 'Cannot add/update trips for past dates' }), { headers: corsHeaders, status: 400 });
    }

    const { error } = await supabaseClient.from('trips').upsert([
      {
        user_id,
        trip_date,
        is_driver,
        notes
      }
    ], { onConflict: ['user_id', 'trip_date'] });

    if (error) throw error;
    return new Response(JSON.stringify({ trip }), { headers: corsHeaders, status: 201 });
  } catch (error) {
    console.error('Error creating trip:', error);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
}

async function deleteTripByDate(user_id: string, trip_date: string) {
  try {
    if (!trip_date) {
      return new Response(JSON.stringify({ error: 'Trip date required' }), { headers: corsHeaders, status: 400 });
    }

    const formattedCurrentDate = getCurrentDateInMadrid();

    if (trip_date < formattedCurrentDate) {
      return new Response(JSON.stringify({ error: 'Cannot delete trips for past dates' }), { headers: corsHeaders, status: 400 });
    }

    const { error } = await supabaseClient.from('trips').delete()
      .eq('trip_date', trip_date)
      .eq('user_id', user_id);

    if (error) throw error;
    return new Response(JSON.stringify({ message: 'Trip deleted' }), { headers: corsHeaders, status: 200 });
  } catch (error) {
    console.error('Error deleting trip:', error);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
}

async function createKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

Deno.serve(async (req) => {
  const { url, method } = req;

  if (method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let user_id: string | null = null;
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { headers: corsHeaders, status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const SUPABASE_JWT_SECRET = Deno.env.get('JWT_SECRET');

    if (!SUPABASE_JWT_SECRET) {
      return new Response(JSON.stringify({ error: 'JWT secret not configured' }), { headers: corsHeaders, status: 500 });
    }

    const secretKey = await createKey(SUPABASE_JWT_SECRET);
    const decoded = await verify(token, secretKey, { isThrowing: false });

    if (!decoded || !decoded.sub) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { headers: corsHeaders, status: 401 });
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      return new Response(JSON.stringify({ error: 'Token expired' }), { headers: corsHeaders, status: 401 });
    }

    user_id = decoded.sub;
  } catch (error) {
    console.error('JWT verification error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { headers: corsHeaders, status: 500 });
  }

  try {
    const urlObj = new URL(url);
    const pattern = new URLPattern({ pathname: "/trips/:id?" });
    const matchingPath = pattern.exec(url);

    if (matchingPath) {
      const trip_id = matchingPath.pathname.groups.id;

      if (method === 'GET') {
        const stats = urlObj.searchParams.get("stats");
        const csv = urlObj.searchParams.get("csv");
        if (stats === 'true') {
          return await getTripsStats();
        } else {
          const start = urlObj.searchParams.get("start");
          const end = urlObj.searchParams.get("end");
          if(csv === 'true') {
            return await getTripsCSV(start, end);
          }else{
            return await getTrips(start, end);
          }
        }
      }

      if (method === 'POST') {
        const trip = await req.json();
        return await createTrip(user_id!, trip);
      }

      if (method === 'DELETE') {
        if (!trip_id) {
          return new Response(JSON.stringify({ error: 'Trip ID required' }), { headers: corsHeaders, status: 400 });
        }
        return await deleteTripByDate(user_id!, trip_id);
      }
    }

    return new Response(JSON.stringify({ error: 'Route not found' }), { headers: corsHeaders, status: 404 });
  } catch (error) {
    console.error('Request handling error:', error);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 400 });
  }
});
