import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** Things that happened which a client may want to hear about (Settings → Client notifications). */
export type ClientEvent =
  | { type: 'APPOINTMENT_BOOKED'; appointmentId: string }
  | { type: 'APPOINTMENT_RESCHEDULED'; appointmentId: string }
  | { type: 'APPOINTMENT_CANCELLED'; appointmentId: string }
  | { type: 'LAB_RESULTS_READY'; orderId: string }
  | { type: 'PATIENT_DISCHARGED'; admissionId: string }
  | { type: 'PAYMENT_RECEIVED'; paymentId: string }
  | { type: 'VACCINATION_GIVEN'; careItemId: string };

export type ClientEventHandler = (event: ClientEvent) => Promise<void>;

/**
 * Shared registry for client-facing events. Modules emit after their change is saved; subscribers (the messages
 * module) turn them into notifications. A subscriber's failure is logged and never undoes or fails the change.
 */
@Injectable()
export class ClientEvents {
  private readonly log = new Logger(ClientEvents.name);
  private readonly handlers: ClientEventHandler[] = [];

  subscribe(handler: ClientEventHandler) {
    this.handlers.push(handler);
  }

  async emit(event: ClientEvent) {
    for (const h of this.handlers) {
      try {
        await h(event);
      } catch (e) {
        this.log.error(`${event.type} notification failed: ${(e as Error).message}`);
      }
    }
  }
}

@Global()
@Module({ providers: [ClientEvents], exports: [ClientEvents] })
export class ClientEventsModule {}
