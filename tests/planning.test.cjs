const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

// Run the actual inline app script with a small DOM stub; no network or account.
function loadApp() {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.children = [];
      this.style = {};
      this.textContent = '';
      this.value = '';
      this.classes = [];
      this.classList = { add: (name) => this.classes.push(name) };
    }
    get firstChild() { return this.children[0]; }
    appendChild(child) { this.children.push(child); }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener() {}
  }
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: (tag) => new Element(tag),
  };
  const client = {};
  const context = vm.createContext({
    document,
    window: { location: { pathname: '/test' } },
    console: { log() {} },
    supabaseUrl: 'https://example.invalid',
    supabaseKey: 'test',
    supabase: { createClient: () => client },
  });
  const html = readFileSync(`${__dirname}/../frontend/index.html`, 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(script, context);
  vm.runInContext(`
    USER = { email: 'me@example.com' };
    getWeekRange = () => ({ start: '2030-01-07', end: '2030-01-13' });
    getCurrentDateInMadrid = () => '2030-01-07';
  `, context);
  return { context, document, client };
}

function trip(company, firstName, driver = false, email = 'other@example.com') {
  return {
    trip_date: '2030-01-07', is_driver: driver, notes: null,
    profiles: { company, first_name: firstName, last_name: 'Test', seats: 5, email },
  };
}

test('daily company capacity stays separate and own trip actions still work', () => {
  const { context, document } = loadApp();
  context.trips = [
    trip('Beta', 'Me', false, 'me@example.com'),
    trip(' Alpha ', 'Driver', true),
    trip(null, 'Missing'),
    trip('   ', 'Blank'),
    trip('__proto__', 'Special'),
  ];
  context.displayTrips(context.trips);
  const children = document.getElementById('tripsContainer').children;
  const headers = children.filter((el) => el.tagName === 'h6');
  assert.deepEqual(headers.map((el) => el.textContent), [
    '__proto__ · 1/0', 'Alpha · 1/5', 'Beta · 1/0', 'Sin empresa · 2/0',
  ]);
  assert.ok(headers.every((header) => !header.classes.includes('highlight-driver-needed')));
  assert.ok(children[0].textContent.includes('Hoy · 5/5 · Plazas cubiertas'));
  assert.ok(children[0].classes.includes('highlight-driver-not-needed'));

  context.calls = [];
  vm.runInContext(`
    addTrip = (...args) => calls.push(args);
    removeTrip = (...args) => calls.push(args);
    showPrompt = (_, callback) => callback('New notes');
  `, context);
  const ownRow = children.filter((el) => el.tagName === 'ul')[2].children[0];
  const [notes, remove] = ownRow.children[0].children;
  notes.onclick();
  remove.onclick();
  const dayActions = children[0].children[0].children;
  assert.equal(dayActions.length, 1);
  assert.equal(dayActions[0].textContent, '🚗');
  assert.equal(dayActions[0]['aria-label'], 'Reservar como conductor');
  dayActions[0].onclick();
  assert.equal(JSON.stringify(context.calls), JSON.stringify([
    ['2030-01-07', false, 'New notes'], ['2030-01-07'], ['2030-01-07', true, null],
  ]));
});

test('empty plan clears previous groups and keeps daily signup buttons', () => {
  const { context, document } = loadApp();
  context.displayTrips([trip('Alpha', 'Driver', true)]);
  context.displayTrips([]);
  const children = document.getElementById('tripsContainer').children;
  assert.equal(children.length, 5);
  assert.ok(children.every((el) => el.tagName === 'h5'));
  assert.ok(children.every((el) => el.children[0].children.length === 2));
  assert.equal(children[0].children[0].children[1].textContent, '👤');
  assert.equal(children[0].children[0].children[1]['aria-label'], 'Reservar como pasajero');
  assert.ok(children.every((el) => el.textContent.endsWith(' · 0/0 · Sin reservas')));
});

test('daily capacity warns when all companies combined have too few seats', () => {
  const { context, document } = loadApp();
  const driver = trip('Alpha', 'Driver', true);
  driver.profiles.seats = 2;
  context.displayTrips([driver, trip('Beta', 'Passenger'), trip(null, 'Other')]);
  const header = document.getElementById('tripsContainer').children[0];
  assert.ok(header.textContent.endsWith(' · 3/2 · Falta 1 plaza'));
  assert.ok(header.classes.includes('highlight-driver-needed'));
  assert.equal(header.children[1].href, '#statsContainer');
  assert.ok(header.children[1].textContent.includes('Se necesitan conductores'));
});

test('switching from passenger to driver keeps notes', () => {
  const { context, document } = loadApp();
  const ownTrip = trip('Alpha', 'Me', false, 'me@example.com');
  ownTrip.notes = 'Salgo a las 8';
  context.displayTrips([ownTrip]);
  context.calls = [];
  vm.runInContext('addTrip = (...args) => calls.push(args)', context);
  document.getElementById('tripsContainer').children[0].children[0].children[0].onclick();
  assert.equal(JSON.stringify(context.calls), JSON.stringify([
    ['2030-01-07', true, 'Salgo a las 8'],
  ]));
});

test('driver order keeps the lowest total ratio first and TOTAL last', () => {
  const { context, document } = loadApp();
  const stat = (name, email, ratio) => ({
    first_name: name, email, driver_ratio: ratio, driver_trips: 1,
    passenger_trips: 3, driver_trips_until_today: 1,
    passenger_trips_until_today: 2, driver_ratio_until_today: 1 / 3,
  });
  context.displayStats([
    stat('TOTAL', null, .1), stat('Often', 'often@example.com', .8),
    stat('Next', 'me@example.com', .2),
  ]);
  const rows = document.getElementById('userStats').children[0].children[1].children;
  assert.deepEqual(rows.map((row) => row.children[0].textContent), ['1. Next', '2. Often', 'TOTAL']);
  assert.equal(rows[0].className, 'ownTrip');
});

test('saving blocks duplicate requests and unlocks after refreshing', async () => {
  const { context, document, client } = loadApp();
  let finish;
  let count = 0;
  client.functions = { invoke: () => {
    count++;
    return new Promise((resolve) => { finish = resolve; });
  } };
  vm.runInContext('fetchTrips = async () => {}; fetchTripsStats = async () => {}', context);
  const first = context.addTrip('2030-01-07', true, null);
  await context.addTrip('2030-01-07', false, null);
  assert.equal(count, 1);
  assert.equal(document.getElementById('tripsContainer').inert, true);
  assert.equal(document.getElementById('saveStatus').textContent, 'Guardando…');
  finish({ error: null });
  await first;
  assert.equal(document.getElementById('tripsContainer').inert, false);
  assert.equal(document.getElementById('tripsContainer')['aria-busy'], 'false');
  assert.equal(document.getElementById('saveStatus').textContent, 'Reserva guardada · Conductor');
});

test('failed saves retain the plan and allow retry', async () => {
  const { context, document, client } = loadApp();
  context.displayTrips([trip('Alpha', 'Driver', true)]);
  const before = document.getElementById('tripsContainer').children[0];
  let fail = true;
  client.functions = { invoke: async () => {
    if (fail) throw new Error('Offline');
    return { error: null };
  } };
  vm.runInContext('fetchTrips = async () => {}; fetchTripsStats = async () => {}', context);
  await context.removeTrip('2030-01-07');
  assert.equal(document.getElementById('tripsContainer').children[0], before);
  assert.ok(document.getElementById('errorMsg').textContent.includes('No se pudo'));
  assert.equal(document.getElementById('tripsContainer').inert, false);
  fail = false;
  await context.removeTrip('2030-01-07');
  assert.equal(document.getElementById('errorMsg').textContent, '');
  assert.equal(document.getElementById('saveStatus').textContent, 'Reserva cancelada');
});

test('quick week changes ignore late responses from a previous request', async () => {
  const { context, document, client } = loadApp();
  const pending = [];
  client.functions = { invoke: () => new Promise((resolve) => pending.push(resolve)) };
  document.getElementById('weekPicker').value = '2030-W02';
  const first = context.fetchTrips();
  document.getElementById('weekPicker').value = '2030-W03';
  const second = context.fetchTrips();
  pending[1]({ data: { trips: [trip('Current', 'Current')] }, error: null });
  await second;
  pending[0]({ data: { trips: [trip('Stale', 'Stale')] }, error: null });
  await first;
  const text = document.getElementById('tripsContainer').children
    .filter((el) => el.tagName === 'h6').map((el) => el.textContent).join(' ');
  assert.ok(text.includes('Current'));
  assert.ok(!text.includes('Stale'));
  assert.equal(document.getElementById('loading').style.display, 'none');
});

test('past days collapse with totals visible while today and future days stay open', () => {
  const { context, document } = loadApp();
  vm.runInContext(`getCurrentDateInMadrid = () => '2030-01-09'`, context);
  context.displayTrips([trip('Alpha', 'Me', true, 'me@example.com')]);
  const days = document.getElementById('tripsContainer').children;
  assert.deepEqual(days.map((el) => el.tagName), [
    'details', 'details', 'h5', 'h5', 'h5',
  ]);
  const pastDay = days[0];
  assert.ok(!pastDay.open);
  assert.equal(pastDay.children[0].tagName, 'summary');
  const header = pastDay.children[0].children[0];
  assert.ok(header.textContent.endsWith(' · 1/5 · 4 plazas libres'));
  assert.ok(header.classes.includes('highlight-driver-not-needed'));
  assert.equal(header.children.length, 0);
  assert.equal(pastDay.children[1].textContent, 'Alpha · 1/5');
  assert.equal(pastDay.children[2].children[0].children.length, 0);
  assert.equal(days[2].children[0].children.length, 2);

  vm.runInContext(`getCurrentDateInMadrid = () => '2030-01-14'`, context);
  context.displayTrips([]);
  assert.ok(document.getElementById('tripsContainer').children.every(
    (el) => el.tagName === 'details' && !el.open
  ));
});
