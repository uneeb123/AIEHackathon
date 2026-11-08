import { MongoClient } from "mongodb";

type Fields = Record<string, string | number | boolean>;

let connecting: Promise<MongoClient | undefined> | undefined;
let quietUntil = 0;

export function record(kind: string, fields: Fields = {}) {
  const uri = process.env.MONGODB_URI;
  if (!uri || Date.now() < quietUntil) return;
  const doc = { kind, at: new Date(), ...fields };
  void client(uri)
    .then((ready) => ready?.db("aie").collection("events").insertOne(doc))
    .catch((error) => {
      connecting = undefined;
      quietUntil = Date.now() + 30_000;
      console.error("observe:", describe(error));
    });
}

function client(uri: string) {
  connecting ??= new MongoClient(uri, {
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 8_000,
  })
    .connect()
    .then(async (ready) => {
      await ready.db("aie").collection("events").createIndex({ at: -1 });
      return ready;
    })
    .catch((error) => {
      connecting = undefined;
      quietUntil = Date.now() + 30_000;
      console.error("observe:", describe(error));
      return undefined;
    });
  return connecting;
}

function describe(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "mongodb://…").slice(0, 300);
}
