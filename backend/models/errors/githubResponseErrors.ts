import { z } from "zod";

export class GithubResponseParseError extends Error {
  endpoint: string;
  status: number;
  response: unknown;
  zodError: z.ZodError;

  constructor(
    schemaName: string,
    endpoint: string,
    status: number,
    response: unknown,
    zodError: z.ZodError,
  ) {
    super(
      `GitHub response failed ${schemaName} validation for ${endpoint} ` +
        `(status ${status}): ${zodError.message}. Response: ${stringifyJson(
          response,
        )}`,
      { cause: zodError },
    );
    this.name = "GithubResponseParseError";
    this.endpoint = endpoint;
    this.status = status;
    this.response = response;
    this.zodError = zodError;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      endpoint: this.endpoint,
      status: this.status,
      response: this.response,
      zodError: this.zodError,
    };
  }
}

export class GithubResponseShapeError extends Error {
  endpoint: string;
  status: number;
  response: unknown;

  constructor(
    expectation: string,
    endpoint: string,
    status: number,
    response: unknown,
  ) {
    super(
      `GitHub response failed shape validation for ${endpoint} ` +
        `(status ${status}): expected ${expectation}. Response: ${stringifyJson(
          response,
        )}`,
    );
    this.name = "GithubResponseShapeError";
    this.endpoint = endpoint;
    this.status = status;
    this.response = response;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      endpoint: this.endpoint,
      status: this.status,
      response: this.response,
    };
  }
}

export class GithubResponseStatusError extends Error {
  endpoint: string;
  status: number;
  response: unknown;

  constructor(endpoint: string, status: number, response: unknown) {
    super(
      `GitHub request failed for ${endpoint} ` +
        `(status ${status}). Response: ${stringifyJson(response)}`,
    );
    this.name = "GithubResponseStatusError";
    this.endpoint = endpoint;
    this.status = status;
    this.response = response;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      endpoint: this.endpoint,
      status: this.status,
      response: this.response,
    };
  }
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
