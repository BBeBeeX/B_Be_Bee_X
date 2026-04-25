// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_secret_charles_xavier.sql';
import m0001 from './0001_network_proxy_settings.sql';
import m0002 from './0002_plugin_registry.sql';
import m0003 from './0003_align_database_with_models.sql';
import m0004 from './0004_add_database_sync_metadata.sql';

  export default {
    journal,
    migrations: {
      m0000,
      m0001,
      m0002,
      m0003,
      m0004
    }
  }
  
