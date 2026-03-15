import Conf from "conf";

export interface AppConfig {
  debrid: {
    provider: "realdebrid" | "none";
    apiKey: string;
  };
  qbittorrent: {
    url: string;
    username: string;
    password: string;
  };
  download: {
    outputDir: string;
    maxConcurrent: number;
    preferredQuality: string;
  };
  addons: {
    streamUrl: string;
  };
}

export const config = new Conf<AppConfig>({
  projectName: "stremio-dl",
  schema: {
    debrid: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["realdebrid", "none"],
          default: "none",
        },
        apiKey: { type: "string", default: "" },
      },
      default: { provider: "none", apiKey: "" },
    },
    qbittorrent: {
      type: "object",
      properties: {
        url: { type: "string", default: "http://localhost:8080" },
        username: { type: "string", default: "admin" },
        password: { type: "string", default: "adminadmin" },
      },
      default: {
        url: "http://localhost:8080",
        username: "admin",
        password: "adminadmin",
      },
    },
    download: {
      type: "object",
      properties: {
        outputDir: { type: "string", default: "./downloads" },
        maxConcurrent: { type: "number", minimum: 1, maximum: 10, default: 2 },
        preferredQuality: { type: "string", default: "1080p" },
      },
      default: {
        outputDir: "./downloads",
        maxConcurrent: 2,
        preferredQuality: "1080p",
      },
    },
    addons: {
      type: "object",
      properties: {
        streamUrl: { type: "string", default: "" },
      },
      default: { streamUrl: "" },
    },
  },
});
