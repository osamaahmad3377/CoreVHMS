import { Global, Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PatientsModule } from '../patients/patients.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Global()
@Module({ imports: [ClientsModule, PatientsModule], controllers: [SearchController], providers: [SearchService], exports: [SearchService] })
export class SearchModule {}
