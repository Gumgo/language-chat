import ESLintWebpackPlugin from "eslint-webpack-plugin";
import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import path from "path";
import StylelintWebpackPlugin from "stylelint-webpack-plugin";
import { Configuration } from "webpack";
import WebpackBuildNotifierPlugin from "webpack-build-notifier";

export function commonConfig(_env: unknown, _args: Record<string, string>): Configuration {
  return (
    {
      devtool: "source-map",

      entry: {
        "index": path.resolve(__dirname, "src/index.tsx"),
        "style": path.resolve(__dirname, "src/index.scss"),
      },

      output: {
        path: path.resolve(__dirname, "dist"),
        publicPath: "/",
        filename: "[name].[contenthash].js",
        assetModuleFilename: "[name].[contenthash][ext][query]",
      },

      resolve: {
        extensions: [".ts", ".tsx", ".js", ".jsx"],
        modules: [
          path.resolve(__dirname, "src"),
          "node_modules",
        ],
      },

      externals: "dom-speech-recognition",

      module: {
        rules: [
          {
            test: /\.(ts|js|tsx|jsx)$/i,
            exclude: /node_modules/,
            use: {
              loader: "babel-loader",
              options: {
                cacheDirectory: true,
                babelrc: false,
                presets: [
                  [
                    "@babel/preset-env",
                    {
                      targets: ">0.2%, not dead",
                      useBuiltIns: "entry",
                      corejs: "3.8",
                    },
                  ],
                  "@babel/preset-typescript",
                  "@babel/preset-react",
                ],
                plugins: [
                  ["@babel/plugin-proposal-decorators", { legacy: true }],
                  "@babel/plugin-transform-runtime",
                ],
              },
            },
          },
          {
            test: /\.css$/i,
            use: [
              MiniCssExtractPlugin.loader,
              {
                loader: "css-loader",
                options: {
                  url: false,
                },
              },
            ],
          },
          {
            test: /\.(sass|scss)$/i,
            use: [
              MiniCssExtractPlugin.loader,
              {
                loader: "css-loader",
                options: {
                  url: false,
                },
              },
              {
                loader: "postcss-loader",
              },
              {
                loader: "sass-loader",
                options: {
                  sassOptions: {
                    includePaths: [
                      "node_modules",
                      "assets",
                    ],
                  },
                },
              },
            ],
          },
        ],
      },

      plugins: [
        new WebpackBuildNotifierPlugin(
          {
            title: "Language Chat",
          }),
        new ForkTsCheckerWebpackPlugin(),
        new MiniCssExtractPlugin(
          {
            filename: "[name].[contenthash].css",
            chunkFilename: "[id].[contenthash].css",
          }),
        new HtmlWebpackPlugin(
          {
            filename: "index.html",
            template: "src/template.html",
            title: "Language Chat",
            chunks: ["index", "style"],
            inject: false,
          }),
        new ESLintWebpackPlugin(
          {
            configType: "flat",
            context: "src",
            eslintPath: "eslint/use-at-your-own-risk", // Needed to get the "flat" configs working
            extensions: ["js", "jsx", "ts", "tsx"],
          }),
        new StylelintWebpackPlugin(
          {
            context: "src",
            extensions: ["css", "scss", "sass"],
          }),
      ],
    }
  );
}
