CREATE TABLE profiles
  (id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  email text, 
  first_name text, 
  last_name text,
  seats smallint not null default '5'::smallint,  
  PRIMARY KEY (id));


CREATE FUNCTION handle_new_user() RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER
SET search_path = '' AS $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name');
  return new;
end;
$$;


CREATE TRIGGER on_auth_user_created AFTER
INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE handle_new_user();


CREATE TABLE trips
  (trip_date date NOT NULL,
  created_at timestamp WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  is_driver boolean NOT NULL,
  notes text DEFAULT NULL,
  CONSTRAINT car_sharing_pkey PRIMARY KEY (trip_date, user_id));


CREATE INDEX userid ON trips USING btree (user_id);

CREATE OR REPLACE FUNCTION update_updated_at() 
RETURNS TRIGGER 
SET search_path = 'public' AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_trip_updated_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION get_trip_ratios() 
RETURNS TABLE (
    email TEXT, 
    first_name TEXT,
    last_name TEXT,
    driver_trips INT, 
    passenger_trips INT, 
    driver_ratio DOUBLE PRECISION, 
    driver_trips_until_today INT, 
    passenger_trips_until_today INT, 
    driver_ratio_until_today DOUBLE PRECISION
) 
SET search_path = 'public' AS $$
BEGIN
    RETURN QUERY
    WITH user_stats AS (
        SELECT
            trips.user_id,
            COUNT(*) FILTER (WHERE is_driver = true)::INT AS driver_trips,
            COUNT(*) FILTER (WHERE is_driver = false)::INT AS passenger_trips,
            COUNT(*) FILTER (WHERE is_driver = true AND trips.trip_date < CURRENT_DATE)::INT AS driver_trips_until_today,
            COUNT(*) FILTER (WHERE is_driver = false AND trips.trip_date < CURRENT_DATE)::INT AS passenger_trips_until_today
        FROM trips
        GROUP BY trips.user_id
    )
    SELECT
        profiles.email,
        profiles.first_name,
        profiles.last_name,
        user_stats.driver_trips,
        user_stats.passenger_trips,
        COALESCE(user_stats.driver_trips::DOUBLE PRECISION / NULLIF(user_stats.driver_trips + user_stats.passenger_trips, 0), 0) AS driver_ratio,
        user_stats.driver_trips_until_today,
        user_stats.passenger_trips_until_today,
        COALESCE(user_stats.driver_trips_until_today::DOUBLE PRECISION / NULLIF(user_stats.driver_trips_until_today + user_stats.passenger_trips_until_today, 0), 0) AS driver_ratio_until_today
    FROM user_stats
    JOIN profiles ON user_stats.user_id = profiles.id

    UNION ALL

    SELECT 
        NULL AS email,
        'TOTAL' AS first_name,
        NULL AS last_name,
        COUNT(*) FILTER (WHERE is_driver = true)::INT,
        COUNT(*) FILTER (WHERE is_driver = false)::INT,
        COALESCE(COUNT(*) FILTER (WHERE is_driver = true)::DOUBLE PRECISION / NULLIF(COUNT(*) FILTER (WHERE is_driver = true) + COUNT(*) FILTER (WHERE is_driver = false), 0), 0),
        COUNT(*) FILTER (WHERE is_driver = true AND trip_date < CURRENT_DATE)::INT,
        COUNT(*) FILTER (WHERE is_driver = false AND trip_date < CURRENT_DATE)::INT,
        COALESCE(COUNT(*) FILTER (WHERE is_driver = true AND trip_date < CURRENT_DATE)::DOUBLE PRECISION / NULLIF(COUNT(*) FILTER (WHERE is_driver = true AND trip_date < CURRENT_DATE) + COUNT(*) FILTER (WHERE is_driver = false AND trip_date < CURRENT_DATE), 0), 0)
    FROM trips

    ORDER BY driver_ratio ASC NULLS LAST;
END;
$$ LANGUAGE PLPGSQL;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role to delete profiles"
  ON profiles
  FOR DELETE
  USING (true)  
  TO service_role;

CREATE POLICY "Allow service role to update profiles"
  ON profiles
  FOR UPDATE
  USING (true) 
  WITH CHECK (true)  
  TO service_role;

CREATE POLICY "Allow service role to insert profiles"
  ON profiles
  FOR INSERT
  USING (true)  
  WITH CHECK (true)  
  TO service_role;

CREATE POLICY "Allow service role to select profiles"
  ON profiles
  FOR SELECT
  USING (true)  
  TO service_role;


CREATE POLICY "Allow service role to delete trips"
  ON trips
  FOR DELETE
  USING (true)  
  TO service_role;

CREATE POLICY "Allow service role to update trips"
  ON trips
  FOR UPDATE
  USING (true)
  WITH CHECK (true)  
  TO service_role;

CREATE POLICY "Allow service role to insert trips"
  ON trips
  FOR INSERT
  USING (true) 
  WITH CHECK (true) 
  TO service_role;

CREATE POLICY "Allow service role to select trips"
  ON trips
  FOR SELECT
  USING (true) 
  TO service_role;
