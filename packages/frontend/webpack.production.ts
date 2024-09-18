import { Configuration } from "webpack";

export const productionConfig: Configuration = {
  mode: "production",

  output: {
    clean: true,
  },
};
