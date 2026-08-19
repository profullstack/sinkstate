import { connect } from './index.js';
import { migrate } from './migrate.js';

const applied = await migrate(connect());
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
