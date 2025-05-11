import { getDb as getDbFromDatabase } from '@meridian/database';

export function getDb(hyperdrive: Hyperdrive) {
  return getDbFromDatabase(hyperdrive.connectionString, {
    // Workers limit the number of concurrent external connections, so be sure to limit
    // the size of the local connection pool that postgres.js may establish.
    max: 5,

    // If you are not using array types in your Postgres schema,
    // disabling this will save you an extra round-trip every time you connect.
    fetch_types: false,
  });
} 