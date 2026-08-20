export { lookupGnaf, scoreGnafAgainstParsed, MATCH_LEVEL } from "./lookup.js";
export {
  getGnafStore,
  resetGnafStoreCache,
  DEFAULT_SQLITE,
  DEFAULT_JSONL,
} from "./store.js";
export {
  toLookupKeys,
  normalizeStreetType,
  normalizeStreetName,
  normalizeHouseNumber,
  normalizeLocality,
} from "./street-normalize.js";
