import type { SpeciesCategory } from '@prisma/client';

/**
 * Starter species/breed catalogue created for each new organization.
 * This is a convenience list for registration forms, not clinical guidance; clinics can edit it.
 */
export const DEFAULT_SPECIES: { name: string; category: SpeciesCategory; breeds: string[] }[] = [
  {
    name: 'Dog',
    category: 'COMPANION',
    breeds: [
      'Mixed breed', 'Labrador Retriever', 'German Shepherd', 'Golden Retriever', 'Rottweiler', 'Siberian Husky',
      'Beagle', 'Poodle', 'Bulldog', 'French Bulldog', 'Dachshund', 'Shih Tzu', 'Pomeranian', 'Chihuahua',
      'Border Collie', 'Australian Cattle Dog', 'Australian Kelpie', 'Staffordshire Bull Terrier',
      'Cavalier King Charles Spaniel', 'Jack Russell Terrier', 'Doberman Pinscher', 'Great Dane', 'Bully Kutta',
      'Gaddi Kutta', 'Pakistani Mastiff', 'Cocker Spaniel', 'Maltese', 'Boxer',
    ],
  },
  {
    name: 'Cat',
    category: 'COMPANION',
    breeds: ['Domestic Shorthair', 'Domestic Longhair', 'Persian', 'Siamese', 'Maine Coon', 'British Shorthair',
      'Ragdoll', 'Bengal', 'Himalayan', 'Scottish Fold', 'Sphynx', 'Mixed breed'],
  },
  { name: 'Rabbit', category: 'COMPANION', breeds: ['Mixed breed', 'Netherland Dwarf', 'Holland Lop', 'Mini Rex', 'Angora', 'Lionhead', 'Dutch'] },
  { name: 'Guinea pig', category: 'EXOTIC', breeds: ['American', 'Abyssinian', 'Peruvian', 'Teddy'] },
  { name: 'Hamster', category: 'EXOTIC', breeds: ['Syrian', 'Dwarf Campbell', 'Roborovski', 'Winter White'] },
  { name: 'Ferret', category: 'EXOTIC', breeds: [] },
  { name: 'Companion bird', category: 'EXOTIC', breeds: ['Budgerigar', 'Cockatiel', 'Lovebird', 'African Grey Parrot', 'Cockatoo', 'Macaw', 'Canary', 'Finch', 'Pigeon'] },
  { name: 'Reptile', category: 'EXOTIC', breeds: ['Tortoise', 'Turtle', 'Bearded Dragon', 'Python', 'Gecko'] },
  {
    name: 'Cattle',
    category: 'LIVESTOCK',
    breeds: ['Sahiwal', 'Red Sindhi', 'Cholistani', 'Tharparkar', 'Dhanni', 'Holstein Friesian', 'Jersey',
      'Angus', 'Hereford', 'Brahman', 'Droughtmaster', 'Murray Grey', 'Charolais', 'Crossbred'],
  },
  { name: 'Buffalo', category: 'LIVESTOCK', breeds: ['Nili-Ravi', 'Kundi', 'Azi Kheli', 'Murrah', 'Crossbred'] },
  { name: 'Sheep', category: 'LIVESTOCK', breeds: ['Lohi', 'Kajli', 'Kachhi', 'Thalli', 'Merino', 'Dorper', 'Poll Dorset', 'Border Leicester', 'Crossbred'] },
  { name: 'Goat', category: 'LIVESTOCK', breeds: ['Beetal', 'Dera Din Panah', 'Teddy', 'Kamori', 'Nachi', 'Boer', 'Saanen', 'Anglo-Nubian', 'Kalahari Red', 'Crossbred'] },
  { name: 'Camel', category: 'LIVESTOCK', breeds: ['Marecha', 'Brela', 'Dhatti', 'Dromedary (other)'] },
  { name: 'Pig', category: 'LIVESTOCK', breeds: ['Large White', 'Landrace', 'Duroc', 'Berkshire', 'Crossbred'] },
  { name: 'Chicken', category: 'POULTRY', breeds: ['Broiler', 'Layer', 'Aseel', 'Desi', 'Fayoumi', 'Rhode Island Red', 'Australorp'] },
  { name: 'Duck', category: 'POULTRY', breeds: ['Pekin', 'Khaki Campbell', 'Muscovy'] },
  { name: 'Turkey', category: 'POULTRY', breeds: [] },
  { name: 'Quail', category: 'POULTRY', breeds: ['Japanese'] },
  { name: 'Horse', category: 'EQUINE', breeds: ['Thoroughbred', 'Arabian', 'Australian Stock Horse', 'Quarter Horse', 'Kathiawari', 'Pony', 'Crossbred'] },
  { name: 'Donkey', category: 'EQUINE', breeds: [] },
  { name: 'Mule', category: 'EQUINE', breeds: [] },
];
