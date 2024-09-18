// Note: this file only exists because of jest. A slightly cleaner approach is probably to incorporate jest into the webpack config.
module.exports = {
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
    [
      "module-resolver", {
        root: ["./src"],
        extensions: [".js", ".ts", ".jsx", ".tsx"],
      },
    ],
  ],
};
