export * from "./types.js";
export * from "./api/cinemeta.js";
export * from "./api/addon.js";
export {
  addMagnet as rdAddMagnet,
  getTorrentInfo as rdGetTorrentInfo,
  selectFiles as rdSelectFiles,
  unrestrictLink as rdUnrestrictLink,
  deleteTorrent as rdDeleteTorrent,
  waitForDownload as rdWaitForDownload,
  getDownloadLinks as rdGetDownloadLinks,
} from "./api/real-debrid.js";
export {
  login as qbLogin,
  addMagnet as qbAddMagnet,
  getTorrentInfo as qbGetTorrentInfo,
  getFiles as qbGetFiles,
  setFilePriority as qbSetFilePriority,
  resumeTorrent as qbResumeTorrent,
  waitForMetadata as qbWaitForMetadata,
  waitForCompletion as qbWaitForCompletion,
} from "./api/qbittorrent.js";
export * from "./core/resolver.js";
export * from "./core/downloader.js";
export { config } from "./config.js";
