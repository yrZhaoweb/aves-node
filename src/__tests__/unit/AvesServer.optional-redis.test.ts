describe("AvesServer optional Redis dependency", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("ioredis");
  });

  it("should not load ioredis when using memory storage", () => {
    jest.isolateModules(() => {
      jest.doMock("ioredis", () => {
        throw new Error("ioredis should not be required for memory storage");
      });

      const { AvesServer } = require("../../core/AvesServer") as typeof import("../../core/AvesServer");
      const server = new AvesServer({ debug: false });
      server.close();
    });
  });
});
