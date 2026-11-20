import { createApp } from "./main.ts";

let appPromise;

function getApp() {
  if (!appPromise) {
    appPromise = createApp()
      .then(({ app }) => app)
      .catch((error) => {
        // Do not poison future requests if cold-start initialization fails transiently.
        appPromise = undefined;
        throw error;
      });
  }
  return appPromise;
}

export default {
  async fetch(request) {
    const app = await getApp();
    return await app.fetch(request);
  },
};
