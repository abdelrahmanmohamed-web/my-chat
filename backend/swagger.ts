import swaggerAutogen from "swagger-autogen";

const doc = {
  info: {
    title: "my-chat Backend API",
    description: "Automatically generated API documentation",
    version: "0.0.0",
  },
  host: "localhost:3000",
  schemes: ["http"],
  basePath: "/api/v1",
  consumes: ["application/json"],
  produces: ["application/json"],
};

const outputFile = "./swagger-output.json";

const routes = ["./src/routes/index.ts"];

swaggerAutogen()(outputFile, routes, doc);
