export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | undefined
  | {
      [key: string]: JsonValue;
    };

export type MockResponse = {
  body: JsonValue;
  status: number;
};

export type MockUrls = {
  [url: string]: MockResponse;
};

export function mockFetch(mockList: MockUrls) {
  globalThis.fetch = (input: string | Request | URL): Promise<Response> => {
    let url: string;

    if (typeof input === "string") {
      url = input;
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = input.toString();
    }

    if (mockList[url]) {
      return Promise.resolve(
        new Response(JSON.stringify(mockList[url].body), {
          status: mockList[url].status,
        }),
      );
    }

    return Promise.reject(new Error(`No mock for URL: ${url}`));
  };
}
