import { Configuration } from "webpack";
import { merge } from "webpack-merge";
import { commonConfig } from "./webpack.common";
import { developmentConfig } from "./webpack.development";
import { productionConfig } from "./webpack.production";

function config(env: unknown, args: Record<string, string>): Configuration {
  switch (args.mode) {
    case "development":
      return merge(commonConfig(env, args), developmentConfig);

    case "production":
      return merge(commonConfig(env, args), productionConfig);

    default:
      throw new Error("Invalid mode specified");
  }
}

export default config;
