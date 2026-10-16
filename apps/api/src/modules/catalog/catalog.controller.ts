import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { breedSchema, speciesSchema } from '@vcms/shared';
import { z } from 'zod';
import { RequireAnyPermission, RequirePermissions } from '../../common/auth/decorators';
import { ApiZodBody, zp } from '../../common/http/zod';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@Controller('species')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @RequireAnyPermission('patients.read', 'settings.manage', 'livestock.read')
  list(@Query('all') all?: string) {
    return this.catalog.listSpecies(all === 'true');
  }

  @Get(':id/breeds')
  @RequireAnyPermission('patients.read', 'settings.manage', 'livestock.read')
  breeds(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.listBreeds(id);
  }

  @Post()
  @RequirePermissions('settings.manage')
  @ApiZodBody(speciesSchema)
  create(@Body(zp(speciesSchema)) body: z.infer<typeof speciesSchema>) {
    return this.catalog.createSpecies(body);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  @ApiZodBody(speciesSchema.partial())
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zp(speciesSchema.partial())) body: Partial<z.infer<typeof speciesSchema>>) {
    return this.catalog.updateSpecies(id, body);
  }

  @Post('breeds')
  @RequirePermissions('settings.manage')
  @ApiZodBody(breedSchema)
  createBreed(@Body(zp(breedSchema)) body: z.infer<typeof breedSchema>) {
    return this.catalog.createBreed(body.speciesId, body.name);
  }

  @Patch('breeds/:id')
  @RequirePermissions('settings.manage')
  setBreed(@Param('id', ParseUUIDPipe) id: string, @Body(zp(z.object({ isActive: z.boolean() }))) body: { isActive: boolean }) {
    return this.catalog.setBreedActive(id, body.isActive);
  }
}
