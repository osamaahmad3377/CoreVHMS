import { ArgumentMetadata, BadRequestException, PipeTransform, applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { ZodError, ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function formatZodError(error: ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
}

/** Validates and transforms a request part against a Zod schema. */
export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown, _meta: ArgumentMetadata): any {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'The request contains invalid data',
        details: formatZodError(result.error),
      });
    }
    return result.data;
  }
}

export const zp = (schema: ZodTypeAny) => new ZodPipe(schema);

function toOpenApi(schema: ZodTypeAny): Record<string, any> {
  const json = (zodToJsonSchema as (s: unknown, o: unknown) => any)(schema, { target: 'openApi3', $refStrategy: 'none' });
  delete json.$schema;
  return json;
}

/** OpenAPI documentation for a Zod-validated body. */
export const ApiZodBody = (schema: ZodTypeAny) => ApiBody({ schema: toOpenApi(schema) });

/** OpenAPI documentation for Zod-validated query parameters. */
export function ApiZodQuery(schema: ZodTypeAny) {
  const json = toOpenApi(schema);
  const props = (json.properties ?? {}) as Record<string, any>;
  const required: string[] = json.required ?? [];
  return applyDecorators(
    ...Object.entries(props).map(([name, s]) =>
      ApiQuery({ name, required: required.includes(name) && s.default === undefined, schema: s }),
    ),
  );
}
