/**
 * The common grooming services, each an appointment type in the Grooming category: booked without a vet, bookable
 * online, and charged with the clinic's price of the same name (a new price at 0 when it has none yet, set by the
 * clinic). Names only — nothing clinical.
 */
export const GROOMING_TYPES: { name: string; aliases?: string[]; minutes: number; code: string }[] = [
  { name: 'Full groom', minutes: 90, code: 'GROOM-FULL' },
  { name: 'Bath & blow-dry', aliases: ['Bath and blow-dry', 'Bath & dry'], minutes: 60, code: 'GROOM-BATH' },
  { name: 'Nail trim', aliases: ['Nail clipping', 'Claw clip'], minutes: 15, code: 'GROOM-NAILS' },
  { name: 'Ear cleaning (grooming)', aliases: ['Ear cleaning'], minutes: 15, code: 'GROOM-EARS' },
  { name: 'De-shedding treatment', aliases: ['De-shedding'], minutes: 60, code: 'GROOM-DESHED' },
  { name: 'Hygiene trim', aliases: ['Sanitary trim'], minutes: 30, code: 'GROOM-HYGIENE' },
  { name: 'Haircut / breed trim', aliases: ['Haircut', 'Breed trim'], minutes: 90, code: 'GROOM-CUT' },
  { name: 'Face, feet & tail tidy', aliases: ['Face and feet tidy', 'Tidy-up trim'], minutes: 30, code: 'GROOM-TIDY' },
  { name: 'Dematting', aliases: ['De-matting'], minutes: 60, code: 'GROOM-DEMAT' },
  { name: 'Medicated bath', minutes: 45, code: 'GROOM-MEDBATH' },
  { name: 'Flea & tick bath', aliases: ['Flea bath'], minutes: 45, code: 'GROOM-FLEABATH' },
  { name: 'Teeth brushing', minutes: 15, code: 'GROOM-TEETH' },
  { name: 'Anal gland expression', minutes: 15, code: 'ANALGLAND' },
  { name: 'Puppy / kitten first groom', aliases: ['Puppy groom', 'Kitten groom'], minutes: 45, code: 'GROOM-PUPPY' },
  { name: 'Cat groom', aliases: ['Cat grooming'], minutes: 60, code: 'GROOM-CAT' },
  { name: 'Lion cut (cats)', aliases: ['Lion cut'], minutes: 90, code: 'GROOM-LION' },
  { name: 'Paw pad trim', aliases: ['Paw trim'], minutes: 15, code: 'GROOM-PAW' },
];
