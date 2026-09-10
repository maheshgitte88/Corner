import { connect, config } from "./config.js";
import { app } from "./app.js";
import * as models from "./models.js";
import mongoose from "mongoose";
try {
  await connect();
  await Promise.all(Object.values(models).map((m) => m.init()));
  const server = app.listen(config.port, () =>
    console.log(`Counter is running at http://localhost:${config.port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(async () => {
        await mongoose.disconnect();
        process.exit(0);
      }),
    );
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
