import { connectDatabase, disconnectDatabase } from '../config/database.js';
import Service from '../models/Service.js';

const services = [
  {
    name: 'AC Repair',
    description: 'Diagnose and repair air conditioner faults such as cooling issues and leaks.',
    category: 'AC',
  },
  {
    name: 'AC Installation',
    description: 'Install split or window air conditioners including mounting and test run.',
    category: 'AC',
  },
  {
    name: 'AC Maintenance',
    description: 'Routine air conditioner servicing, deep cleaning and gas level check.',
    category: 'AC',
  },
  {
    name: 'Plumbing',
    description: 'Fix leaking taps, blocked drains, pipe damage and bathroom fittings.',
    category: 'PLUMBING',
  },
  {
    name: 'Electrical Repair',
    description: 'Repair wiring, switches, sockets, fans and lighting problems safely.',
    category: 'ELECTRICAL',
  },
  {
    name: 'Washing Machine Repair',
    description: 'Repair washing machine drainage, spin, noise and control panel faults.',
    category: 'APPLIANCE',
  },
  {
    name: 'Refrigerator Repair',
    description: 'Repair refrigerator cooling, compressor, thermostat and gas related issues.',
    category: 'APPLIANCE',
  },
];

async function seedServices() {
  await connectDatabase();

  let insertedCount = 0;

  for (const service of services) {
    const result = await Service.updateOne(
      { name: service.name },
      { $setOnInsert: { ...service, isActive: true } },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      insertedCount += 1;
    }
  }

  console.log(
    `Seeded services: ${insertedCount} inserted, ${services.length - insertedCount} already present`,
  );

  await disconnectDatabase();
}

seedServices().catch(async (error) => {
  console.error('Failed to seed services:', error.message);
  await disconnectDatabase();
  process.exit(1);
});
