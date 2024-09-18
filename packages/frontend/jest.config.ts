import { JestConfigWithTsJest } from "ts-jest";

const config: JestConfigWithTsJest = {
  globals: {
    "ts-jest": {
      tsconfig: "tsconfig.json",
    },
  },
};

export default config;
