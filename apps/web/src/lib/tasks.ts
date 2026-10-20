import type { OptionalModule, Permission } from '@vcms/shared';
import { BarChart3, BedDouble, Boxes, CalendarPlus, ClipboardList, CreditCard, FileText, FlaskConical, HelpCircle, Home, Mail, PackageCheck, PawPrint, Pill, Printer, Receipt, Scissors, ShieldCheck, ShoppingCart, Stethoscope, Syringe, Tractor, UserCog, UserPlus, Wallet, type LucideIcon } from 'lucide-react';

export interface Task {
  /** What the person wants to do, in their own words ("Take a payment"). */
  label: string;
  /** Other words people use for the same thing; matched as they type. */
  keywords: string;
  href: string;
  icon: LucideIcon;
  /** The task is offered when the user holds any of these permissions (empty = everyone). */
  anyOf: Permission[];
  module?: OptionalModule;
}

/**
 * "I want to…" — everyday jobs in plain words, each going straight to the right screen. People find work by
 * saying what they want to do instead of knowing which menu holds it.
 */
export const TASKS: Task[] = [
  { label: 'Check in someone who has arrived', keywords: 'arrived arrival waiting reception walk-in emergency check in front desk queue', href: '/front-desk', icon: ClipboardList, anyOf: ['appointments.checkin'] },
  { label: 'Book an appointment', keywords: 'appointment booking schedule visit slot calendar new', href: '/calendar?book=1', icon: CalendarPlus, anyOf: ['appointments.write'] },
  { label: 'See today’s appointments', keywords: 'calendar today diary schedule day', href: '/calendar', icon: CalendarPlus, anyOf: ['appointments.read'] },
  { label: 'Add a new client (pet owner)', keywords: 'new client owner customer register person farmer add', href: '/clients/new', icon: UserPlus, anyOf: ['clients.write'] },
  { label: 'Add a new patient (animal)', keywords: 'new patient pet animal dog cat register add', href: '/patients/new', icon: PawPrint, anyOf: ['patients.write'] },
  { label: 'Find a client or patient', keywords: 'find search look up client patient owner phone', href: '/patients', icon: PawPrint, anyOf: ['patients.read'] },
  { label: 'Start a consultation', keywords: 'consult exam examine see patient vet notes visit', href: '/front-desk', icon: Stethoscope, anyOf: ['clinical.write'] },
  { label: 'Finish or sign my consultation notes', keywords: 'sign notes unsigned finish consultation write notes', href: '/consultations?mine=true', icon: FileText, anyOf: ['clinical.sign', 'clinical.write'] },
  { label: 'Prescribe medicine', keywords: 'prescription prescribe medicine drug tablets', href: '/consultations', icon: Pill, anyOf: ['prescriptions.write'] },
  { label: 'Hand out medicine (pharmacy)', keywords: 'dispense hand over medicine pharmacy prescription collect', href: '/pharmacy', icon: Pill, anyOf: ['pharmacy.dispense', 'prescriptions.read'] },
  { label: 'Order a lab test or X-ray', keywords: 'lab test blood x-ray scan ultrasound sample order', href: '/lab', icon: FlaskConical, anyOf: ['lab.order', 'lab.read'], module: 'lab' },
  { label: 'Enter or check lab results', keywords: 'lab results enter validate approve sample report', href: '/lab', icon: FlaskConical, anyOf: ['lab.read'], module: 'lab' },
  { label: 'Give a vaccination or see who is due', keywords: 'vaccine vaccination injection due overdue reminder booster preventive deworming', href: '/preventive', icon: Syringe, anyOf: ['preventive.read'] },
  { label: 'Send reminders to clients', keywords: 'remind reminder message sms whatsapp email send', href: '/preventive?range=overdue', icon: Mail, anyOf: ['preventive.read', 'communications.send'] },
  { label: 'Admit a patient to the hospital', keywords: 'admit hospital ward inpatient cage stay', href: '/hospital', icon: BedDouble, anyOf: ['hospital.read'], module: 'hospital' },
  { label: 'Schedule or record a surgery', keywords: 'surgery operation theatre spay neuter anaesthesia', href: '/surgery', icon: Scissors, anyOf: ['surgery.read'], module: 'surgery' },
  { label: 'Take a payment', keywords: 'pay payment money cash card receive invoice bill collect charge', href: '/billing/charges', icon: Wallet, anyOf: ['billing.write'] },
  { label: 'Make an invoice', keywords: 'invoice bill charge new create', href: '/billing/invoices/new', icon: Receipt, anyOf: ['billing.write'] },
  { label: 'See who owes money', keywords: 'owes owing debt unpaid outstanding overdue balance', href: '/billing?tab=overdue', icon: CreditCard, anyOf: ['billing.read'] },
  { label: 'Sell something at the shop counter', keywords: 'shop sale sell counter till pos food product', href: '/pos', icon: ShoppingCart, anyOf: ['pos.use'] },
  { label: 'Open or close the cash drawer', keywords: 'cash drawer till count close open register shift', href: '/billing/cash', icon: Wallet, anyOf: ['cash.manage'] },
  { label: 'Print a receipt or invoice', keywords: 'print receipt invoice copy reprint', href: '/billing', icon: Printer, anyOf: ['billing.read'] },
  { label: 'Receive a delivery of stock', keywords: 'receive stock delivery goods supplier arrived', href: '/inventory?receive=1', icon: PackageCheck, anyOf: ['inventory.write'] },
  { label: 'See what is running low', keywords: 'low stock reorder running out order buy', href: '/inventory?filter=low', icon: Boxes, anyOf: ['inventory.read'] },
  { label: 'Order more stock from a supplier', keywords: 'order purchase supplier buy stock reorder', href: '/inventory/purchase-orders', icon: Boxes, anyOf: ['procurement.write'] },
  { label: 'See how the clinic is doing (reports)', keywords: 'report sales profit money income takings summary figures', href: '/reports', icon: BarChart3, anyOf: ['reports.view', 'reports.financial'] },
  { label: 'Boarding or grooming', keywords: 'boarding kennel stay grooming bath trim', href: '/boarding', icon: Home, anyOf: ['boarding.read'], module: 'boarding' },
  { label: 'Farm visit or herd records', keywords: 'farm herd livestock cattle buffalo goat visit milk', href: '/livestock', icon: Tractor, anyOf: ['livestock.read'], module: 'livestock' },
  { label: 'Insurance claim or referral', keywords: 'insurance claim referral policy pre-authorisation', href: '/insurance', icon: ShieldCheck, anyOf: ['insurance.read'], module: 'insurance' },
  { label: 'Add a staff member', keywords: 'staff new user login employee add vet nurse reception', href: '/settings/staff', icon: UserCog, anyOf: ['users.manage'] },
  { label: 'Change prices or add a service', keywords: 'price prices service fee consultation fee tariff change', href: '/settings/services', icon: Receipt, anyOf: ['settings.manage'] },
  { label: 'Change my clinic’s logo and colours', keywords: 'logo colour branding theme look letterhead print design', href: '/settings/branding', icon: FileText, anyOf: ['branding.manage'] },
  { label: 'Get help with a task', keywords: 'help how guide stuck confused learn tour', href: '/help', icon: HelpCircle, anyOf: [] },
];
