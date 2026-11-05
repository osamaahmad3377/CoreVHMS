import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { PatientsModule } from '../patients/patients.module';
import { CertificateTemplatesService } from './certificate-templates.service';
import { CertificatesController, CertificateTemplatesController, PublicCertificatesController } from './certificates.controller';
import { CertificatesIntegrations } from './certificates-integrations';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [PatientsModule, ClientsModule],
  controllers: [CertificatesController, CertificateTemplatesController, PublicCertificatesController],
  providers: [CertificatesService, CertificateTemplatesService, CertificatesIntegrations],
})
export class CertificatesModule {}
