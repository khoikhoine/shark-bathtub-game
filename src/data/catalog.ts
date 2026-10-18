import type { Gate, Rarity, SpeciesSpec } from '../sim/types.ts';
export type { SpeciesSpec } from '../sim/types.ts';
type Row = [string, string, string, Rarity, string, string, string, string, string, string, Gate?, SpeciesSpec['acquisition']?];
const rows: Row[] = [
 ['guppy','Cá bảy màu','Guppy','common','livebearer','Đuôi quạt rộng','Wide fan tail','#659AAA','#E78B58','#EBDDC0'],
 ['goldfish','Cá vàng','Goldfish','common','goldfish','Bụng tròn, đuôi xòe','Round belly, spreading tail','#E9A23B','#F4C95D','#F5E7BC'],
 ['neon-tetra','Cá neon','Neon tetra','common','minnow','Dải xanh và nửa thân đỏ','Blue stripe and red rear half','#3AAECD','#D95B50','#CFE3DC'],
 ['zebra-danio','Cá sọc ngựa','Zebra danio','common','minnow','Sọc dọc thân','Longitudinal stripes','#B8C5BA','#364D66','#E7E4CE'],
 ['platy','Cá mún','Platy','common','livebearer','Thân ngắn, đuôi đen','Short body, black tail','#E8874A','#343B3A','#F2CF9D'],
 ['molly','Cá bình tích','Molly','common','livebearer','Thân kem đốm đen','Cream body, black spots','#DCDDCF','#333B3D','#ECE9D9'],
 ['swordtail','Cá kiếm','Swordtail','common','livebearer','Thùy đuôi dưới kéo dài','Extended lower tail sword','#D87950','#674A40','#EED0A9'],
 ['white-cloud','Cá mây trắng','White cloud minnow','common','minnow','Thân bạc, vây đỏ, dải sáng','Silver body, red fins, bright stripe','#B8C8C5','#BD5B50','#ECE8D6'],
 ['betta','Cá betta','Betta','uncommon','flowing','Vây mềm dài, đuôi rộng','Long flowing fins, broad tail','#3D728D','#9A5F86','#B9D7D4'],
 ['angelfish','Cá ông tiên','Angelfish','uncommon','tall','Thân tam giác cao, sọc đen','Tall triangular body, black bars','#C9D0C4','#394447','#ECE9DA'],
 ['discus','Cá đĩa','Discus','uncommon','tall','Thân đĩa tròn, vân đỏ','Round disc, red tracery','#67A8A3','#C77863','#C9DDD0'],
 ['koi','Cá koi','Koi','uncommon','goldfish','Thân dài, mảng trắng/cam/đen','Long body, white/orange/black patches','#EEE6CF','#D77E45','#343D3B','none','milestone'],
 ['clownfish','Cá hề','Clownfish','uncommon','reef','Ba dải trắng viền tối','Three dark-edged white bars','#E78D42','#F1E9D2','#353C3A'],
 ['blue-tang','Cá tang xanh','Blue tang','uncommon','reef','Thân xanh, mảng đen, đuôi vàng','Blue body, black patch, yellow tail','#426FA6','#283D51','#E4BF55'],
 ['yellow-tang','Cá tang vàng','Yellow tang','uncommon','reef','Thân dẹt và đuôi vàng','Flattened body and yellow tail','#DDC44C','#B49B39','#F0DF8A'],
 ['royal-gramma','Cá gramma hoàng gia','Royal gramma','uncommon','reef','Nửa trước tím, nửa sau vàng','Purple front, yellow rear','#875B98','#E0C14F','#C7A6B4'],
 ['mandarin','Cá trạng nguyên','Mandarinfish','rare','reef','Vân xanh/cam uốn','Curving turquoise/orange lines','#4B9C9A','#D88747','#D8D7A0','raised-1'],
 ['copperband','Cá bướm sọc đồng','Copperband butterflyfish','rare','reef','Mõm dài, dải cam đứng','Long snout, vertical copper bars','#DFDCC4','#C68A50','#F0E9D0','raised-1'],
 ['moorish-idol','Cá thù lù','Moorish idol','rare','tall','Sọc đen/vàng và vây lưng cờ','Black/yellow bands, dorsal streamer','#E8E2C8','#353C3E','#DAC14E','raised-3'],
 ['emperor-angelfish','Cá thiên thần hoàng đế','Emperor angelfish','rare','reef','Nhiều sọc vàng mảnh trên xanh','Fine yellow stripes over blue','#416D8E','#D8C15D','#9EBCC5','filter-2'],
 ['blue-gourami','Cá sặc xanh','Blue gourami','rare','gourami','Thân oval, hai đốm, râu bụng','Oval body, two spots, pelvic feelers','#7AAFB2','#466D80','#CBDBCF'],
 ['blue-cichlid','Cá cichlid xanh','Electric blue cichlid','rare','reef','Thân dày xanh cobalt, sọc đậm','Thick cobalt body, dark bars','#4B8CAF','#335C83','#A4C9CE'],
 ['dwarf-gourami','Cá sặc lùn','Dwarf gourami','rare','gourami','Vân cam/xanh và râu bụng','Orange/blue stripes and feelers','#65A4A7','#CD8260','#D5D8BC'],
 ['rainbowfish','Cá cầu vồng','Rainbowfish','rare','minnow','Thân sau cam, trước xanh','Blue front, orange rear','#6C9FA8','#DDA465','#D9DAC0'],
 ['puffer','Cá nóc','Pufferfish','rare','puffer','Thân cầu, đốm và gai nhỏ','Spherical body, spots and short spines','#9EA47B','#566F63','#E4DBAF'],
 ['lionfish','Cá sư tử','Lionfish','rare','lionfish','Sọc đỏ/kem, vây tia dài','Red/cream bars, long fin rays','#A96E58','#E9D8B6','#6E514A','none','milestone'],
 ['hammerhead','Cá mập đầu búa','Hammerhead shark','rare','shark','Đầu búa rộng, mắt hai đầu, đuôi lệch','Broad hammer head, end-set eyes, asymmetric tail','#829A9E','#536F78','#DCE1CE','raised-1','starter-and-gacha'],
 ['seahorse','Cá ngựa','Seahorse','epic','seahorse','Dáng đứng chữ S, mõm dài, đuôi cuộn','Upright S-body, long snout, curled tail','#C0A261','#8E7C4D','#E2D3A2','none','milestone'],
 ['sunfish','Cá mặt trăng','Ocean sunfish','epic','tall','Đĩa lớn, đuôi cụt, vây trên/dưới cao','Large disc, truncated tail, tall dorsal/anal fins','#8A9D9D','#647E86','#D2D8C8','filter-2'],
 ['ribbon-eel','Cá chình ruy băng','Ribbon eel','epic','eel','Thân ruy băng xanh, mép vây vàng','Blue ribbon body, yellow fin edge','#477F9E','#DBC35D','#A9C9BF'],
 ['stingray','Cá đuối gai','Stingray','epic','ray','Đĩa hình thoi, đốm, đuôi roi','Diamond disc, spots, whip tail','#AC9F80','#6C7564','#DEDAC0'],
 ['manta','Cá đuối manta','Manta ray','epic','ray','Cánh rộng, hai thùy đầu, bụng trắng','Broad wings, paired cephalic lobes, white belly','#455F69','#2C434E','#DCE2D4','none','milestone'],
 ['nurse-shark','Cá mập y tá','Nurse shark','epic','shark','Đầu tù và vây lưng tròn','Blunt head, rounded dorsal fins','#A39C80','#777F6C','#DDD8BD'],
 ['zebra-shark','Cá mập vằn','Zebra shark','epic','shark','Thân nâu đốm, đuôi dài','Spotted brown body, long tail','#BAA071','#756D50','#DFD4AF'],
 ['leopard-shark','Cá mập báo','Leopard shark','epic','shark','Mảng yên ngựa và đốm sẫm','Dark saddle patches and spots','#A2AA97','#596E66','#D9DECA'],
 ['blacktip-shark','Cá mập vây đen','Blacktip reef shark','epic','shark','Đầu vây đen, thân xám sáng','Black fin tips, pale grey body','#91A8AA','#344D58','#DEE2D2','raised-3'],
 ['whale-shark','Cá nhám voi','Whale shark','legendary','shark','Đầu rộng phẳng, hàng đốm trắng','Wide flat head, rows of white spots','#527A8A','#D9E2D4','#A9C6C8','bath-max'],
 ['thresher-shark','Cá mập đuôi dài','Thresher shark','legendary','shark','Thùy đuôi trên dài bằng thân','Upper tail lobe as long as body','#749DAA','#486F83','#DDE3D4','raised-6'],
 ['sawfish','Cá đao','Sawfish','legendary','shark','Mõm đao phẳng có răng hai bên','Flat saw rostrum with lateral teeth','#ADAA89','#7C8E7E','#E0DDC2','bath-3'],
 ['oarfish','Cá mái chèo','Oarfish','legendary','eel','Thân bạc dài, mào/vây đỏ','Long silver ribbon, red crest and fins','#C6D1CC','#C57567','#E4E3D2','none','milestone'],
];
export const CATALOG: readonly SpeciesSpec[] = rows.map((r, index) => ({ id:r[0], index, name:{vi:r[1],en:r[2]}, rarity:r[3],family:r[4],signature:{vi:r[5],en:r[6]},colors:[r[7],r[8],r[9]],gate:r[10]??'none',acquisition:r[11]??'gacha' }));
export const SPECIES: Readonly<Partial<Record<string, SpeciesSpec>>> = Object.fromEntries(CATALOG.map(spec => [spec.id, spec]));
export function species(id: string): SpeciesSpec {
 const result = Object.hasOwn(SPECIES,id) ? SPECIES[id] : undefined; if (!result) throw new Error(`Unknown species: ${id}`); return result;
}
