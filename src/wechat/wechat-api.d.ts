declare module "wechat-api" {
  type WechatCallback<T> = (
    err: Error | null,
    data: T,
    response?: unknown,
  ) => void;

  type AccessToken = {
    accessToken: string;
    expireTime: number;
  };

  class WechatAPI {
    constructor(
      appid: string,
      appsecret: string,
      getToken?: (callback: WechatCallback<AccessToken | undefined>) => void,
      saveToken?: (token: AccessToken, callback: (err?: Error | null) => void) => void,
    );

    getLatestToken(callback: WechatCallback<AccessToken>): void;
    getMenu(callback: WechatCallback<unknown>): void;
    createMenu(menu: unknown, callback: WechatCallback<unknown>): void;
    removeMenu(callback: WechatCallback<unknown>): void;
    getMaterial(mediaId: string, callback: WechatCallback<unknown>): void;
    getMaterials(
      type: "image" | "voice" | "video" | "news",
      offset: number,
      count: number,
      callback: WechatCallback<unknown>,
    ): void;
    uploadImage(filepath: string, callback: WechatCallback<{ url: string }>): void;
    uploadImageMaterial(filepath: string, callback: WechatCallback<unknown>): void;
    uploadThumbMaterial(filepath: string, callback: WechatCallback<unknown>): void;
    uploadVoiceMaterial(filepath: string, callback: WechatCallback<unknown>): void;
    uploadVideoMaterial(
      filepath: string,
      description: { title: string; introduction: string },
      callback: WechatCallback<unknown>,
    ): void;
    createTmpQRCode(
      sceneId: number,
      expireSeconds: number,
      callback: WechatCallback<unknown>,
    ): void;
    createLimitQRCode(sceneId: number, callback: WechatCallback<unknown>): void;
    showQRCodeURL(ticket: string): string;
  }

  export default WechatAPI;
}
