import { connectDatabase, disconnectDatabase } from '../config/database.js';
import Service from '../models/Service.js';

function issue(key, label, description = null) {
  return { key, label, description, isActive: true };
}

const services = [
  {
    name: 'AC Repair',
    description: 'Diagnose and repair air conditioner faults such as cooling issues and leaks.',
    category: 'AC',
    startingPrice: 499,
    isPopular: true,
    issues: [
      issue('NOT_COOLING', 'Not cooling', 'Runs but the air is not cold'),
      issue('MAKING_NOISE', 'Making noise', 'Rattling, buzzing or grinding sounds'),
      issue('WATER_LEAKING', 'Water leaking', 'Water dripping from the indoor unit'),
      issue('WONT_TURN_ON', "Won't turn on", 'No power or does not respond to the remote'),
      issue('BAD_SMELL', 'Bad smell', 'Musty or burning smell when running'),
    ],
  },
  {
    name: 'AC Installation',
    description: 'Install split or window air conditioners including mounting and test run.',
    category: 'AC',
    startingPrice: 1499,
    isPopular: false,
    issues: [
      issue('NEW_SPLIT', 'Install a split AC'),
      issue('NEW_WINDOW', 'Install a window AC'),
      issue('RELOCATE', 'Move an existing AC'),
    ],
  },
  {
    name: 'AC Maintenance',
    description: 'Routine air conditioner servicing, deep cleaning and gas level check.',
    category: 'AC',
    startingPrice: 599,
    isPopular: true,
    issues: [
      issue('NEEDS_SERVICE', 'Needs service', 'Regular cleaning and check-up'),
      issue('GAS_REFILL', 'Gas refill', 'Cooling has dropped over time'),
      issue('DEEP_CLEAN', 'Deep cleaning', 'Foam wash of indoor and outdoor units'),
    ],
  },
  {
    name: 'Plumbing',
    description: 'Fix leaking taps, blocked drains, pipe damage and bathroom fittings.',
    category: 'PLUMBING',
    startingPrice: 299,
    isPopular: true,
    issues: [
      issue('LEAKING_TAP', 'Leaking tap or pipe'),
      issue('BLOCKED_DRAIN', 'Blocked drain or sink'),
      issue('NO_WATER', 'No water or low pressure'),
      issue('TOILET', 'Toilet or flush problem'),
      issue('FITTING', 'Install or replace fittings'),
    ],
  },
  {
    name: 'Electrical Repair',
    description: 'Repair wiring, switches, sockets, fans and lighting problems safely.',
    category: 'ELECTRICAL',
    startingPrice: 249,
    isPopular: true,
    issues: [
      issue('NO_POWER', 'No power in a room or socket'),
      issue('SWITCH_SOCKET', 'Switch or socket not working'),
      issue('FAN', 'Fan problem'),
      issue('LIGHTING', 'Lights flickering or not working'),
      issue('TRIPPING', 'MCB keeps tripping'),
    ],
  },
  {
    name: 'Washing Machine Repair',
    description: 'Repair washing machine drainage, spin, noise and control panel faults.',
    category: 'APPLIANCE',
    startingPrice: 399,
    isPopular: false,
    issues: [
      issue('NOT_DRAINING', 'Not draining'),
      issue('NOT_SPINNING', 'Not spinning'),
      issue('NOISY', 'Loud noise or vibration'),
      issue('WONT_START', "Won't start"),
    ],
  },
  {
    name: 'Refrigerator Repair',
    description: 'Repair refrigerator cooling, compressor, thermostat and gas related issues.',
    category: 'APPLIANCE',
    startingPrice: 449,
    isPopular: false,
    issues: [
      issue('NOT_COOLING', 'Not cooling'),
      issue('FREEZER_ICE', 'Too much ice in freezer'),
      issue('NOISY', 'Making noise'),
      issue('WATER_LEAK', 'Water leaking'),
    ],
  },
];

async function seedServices() {
  await connectDatabase();

  let insertedCount = 0;

  for (const { name, ...details } of services) {
    // Catalogue details are kept current; active/inactive is left to the admin.
    const result = await Service.updateOne(
      { name },
      { $set: details, $setOnInsert: { name, isActive: true } },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      insertedCount += 1;
    }
  }

  console.log(
    `Seeded services: ${insertedCount} inserted, ${services.length - insertedCount} updated`,
  );

  await disconnectDatabase();
}

seedServices().catch(async (error) => {
  console.error('Failed to seed services:', error.message);
  await disconnectDatabase();
  process.exit(1);
});
