"use strict";
WorkTimeApp.data.sokoban = {
  "author": "David W. Skinner",
  "collection": "Microban / Sasquatch",
  "url": "https://raw.githubusercontent.com/sebnozzi/minimicro-sokoban/master/microban.txt",
  "attributionUrl": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/",
  "sha256": "f7f2fa0375e9677d894f81a96587648e8ae69785d0057e88eca8d74749dea331",
  "sources": [
    {
      "id": "microban",
      "collection": "Microban",
      "author": "David W. Skinner",
      "file": "microban.txt",
      "url": "https://raw.githubusercontent.com/sebnozzi/minimicro-sokoban/master/microban.txt",
      "sha256": "f7f2fa0375e9677d894f81a96587648e8ae69785d0057e88eca8d74749dea331",
      "attributionUrl": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/"
    },
    {
      "id": "sasquatch-1",
      "collection": "Sasquatch 1",
      "author": "David W. Skinner",
      "file": "sasquatch-1.txt",
      "url": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/s1.txt",
      "sha256": "66188b306802b8c795abc953547c18010bd9bc6fe42f272fca0d35de65bed72a",
      "attributionUrl": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/"
    },
    {
      "id": "sasquatch-2",
      "collection": "Mas Sasquatch",
      "author": "David W. Skinner",
      "file": "sasquatch-2.txt",
      "url": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/s2.txt",
      "sha256": "ceb1ec0a8352d0efc107d18ad0cf2a61f44472bcbc4128196418bfa0dc3794af",
      "attributionUrl": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/"
    },
    {
      "id": "sasquatch-3",
      "collection": "Sasquatch 3",
      "author": "David W. Skinner",
      "file": "sasquatch-3.txt",
      "url": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/s3.txt",
      "sha256": "f975a40b00ba1fdf355f81521c7447ef40cf9395fa0f6858e00060c44d24e96f",
      "attributionUrl": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/"
    },
    {
      "id": "sasquatch-4",
      "collection": "Sasquatch 4",
      "author": "David W. Skinner",
      "file": "sasquatch-4.txt",
      "url": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/s4.txt",
      "sha256": "2a6ea1c4c0a17bf5ab4e9e4d8986c7d72e25f86be93680f88e99980b512545b8",
      "attributionUrl": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/"
    },
    {
      "id": "sasquatch-5",
      "collection": "Sasquatch 5",
      "author": "David W. Skinner",
      "file": "sasquatch-5.txt",
      "url": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/s5.txt",
      "sha256": "c7e511ad09f132406ca02a879991246c97df47f93f0d922e5ec9a1d1e7ad5209",
      "attributionUrl": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/"
    },
    {
      "id": "sasquatch-6",
      "collection": "Sasquatch 6",
      "author": "David W. Skinner",
      "file": "sasquatch-6.txt",
      "url": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/s6.txt",
      "sha256": "66d314c322519d0674e979190dd4337efedfc6d351d0d793c1838b47651db1c7",
      "attributionUrl": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/"
    },
    {
      "id": "sasquatch-7",
      "collection": "Sasquatch 7",
      "author": "David W. Skinner",
      "file": "sasquatch-7.txt",
      "url": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/s7.txt",
      "sha256": "b91d513917e112debd57810917815f4422bde6b290060cb4031194145586246d",
      "attributionUrl": "https://www.onlinespiele-sammlung.de/sokoban/sokobangames/skinner/"
    }
  ],
  "chapters": [
    {
      "id": "beginner",
      "skin": "forest",
      "ratingRange": [
        1,
        2.5
      ],
      "start": 0,
      "count": 20
    },
    {
      "id": "initiate",
      "skin": "desert",
      "ratingRange": [
        3,
        4.5
      ],
      "start": 20,
      "count": 20
    },
    {
      "id": "amateur",
      "skin": "greenhouse",
      "ratingRange": [
        5,
        6.5
      ],
      "start": 40,
      "count": 20
    },
    {
      "id": "expert",
      "skin": "glacier",
      "ratingRange": [
        7,
        7.5
      ],
      "start": 60,
      "count": 20
    },
    {
      "id": "expertPlus",
      "skin": "space",
      "ratingRange": [
        8,
        8.5
      ],
      "start": 80,
      "count": 20
    },
    {
      "id": "fanatic",
      "skin": "forge",
      "ratingRange": [
        9,
        9.5
      ],
      "start": 100,
      "count": 20
    },
    {
      "id": "master",
      "skin": "palace",
      "ratingRange": [
        10,
        10
      ],
      "start": 120,
      "count": 20
    }
  ],
  "ratingSystem": {
    "reference": "https://aymericdupeloux.wixsite.com/sokoban/post/welcome",
    "assessment": "Local replay-based assessment using the seven Cosmos labels and score ranges, not original author ratings. Local rubric: pushes + 3 * box switches + 12 * goal withdrawals + 5 * boxes. Sort all 140 levels by this score, then stable ID; group into seven chapters of 20. Raw scores are not Cosmos author scores; the seven labels and ranges are adopted as a local classification. No optimality claim for new solution paths."
  },
  "solutionSource": {
    "url": "https://github.com/guylangston/SokoSolve/blob/4045224e65832e5475d9c1c781251b5c3c4d6ac0/data/Lib/solutions.json",
    "file": "sasquatch-solutions.json",
    "sha256": "ab083e8542b00298a06dc2fb5619c47ce81dec5f9491254fe5dde2cc66839a55"
  },
  "optima": {
    "microban-44": {
      "rowsHash": "799fbc22da222af543d1a1e23cad06e97cc5f2a51f06fcf01d6acabd988005b3",
      "moves": {
        "value": 1,
        "path": "r",
        "pushes": 1
      },
      "pushes": {
        "value": 1,
        "path": "r"
      }
    },
    "microban-2": {
      "rowsHash": "aaf18e21759e202e10f846f6f1faa5002a8adea3cfd69fcabfcc6c90b867f6d0",
      "moves": {
        "value": 16,
        "path": "rddlruulduullddr",
        "pushes": 3
      },
      "pushes": {
        "value": 3,
        "path": "rddlruulduullddr"
      }
    },
    "microban-24": {
      "rowsHash": "ce9ee144c5f0faeef509a7a2e3acdb536ee17463eb8fad4db001519e4b135a82",
      "moves": {
        "value": 35,
        "path": "ullddlddrruluuurrdluldddullddrruuld",
        "pushes": 9
      },
      "pushes": {
        "value": 9,
        "path": "ullddlddrruluuurrdluldddullddrruuld"
      }
    },
    "microban-30": {
      "rowsHash": "9c69030b50eaa67e13ec5478e57cd68795d0dc94f2d4d18dd87144818234bfef",
      "moves": {
        "value": 21,
        "path": "uluurdlddrdruruulluld",
        "pushes": 5
      },
      "pushes": {
        "value": 5,
        "path": "uluurdlddrdruruulluld"
      }
    },
    "microban-25": {
      "rowsHash": "5f744e6c159d4d0fdcd8c10889e9cf3a3de728fb91f3402d6354da84bbb054fb",
      "moves": {
        "value": 29,
        "path": "urrdlulluurdldrlddrurruulluld",
        "pushes": 7
      },
      "pushes": {
        "value": 7,
        "path": "urrdlullddrulurluurdlddrrruulluld"
      }
    },
    "microban-3": {
      "rowsHash": "e689b50767df7d963cf2a703e07602f3311458f29556aafc72e4920625748d37",
      "moves": {
        "value": 41,
        "path": "ruullluldrrrrddlurulllddllluurrdrdluuurdd",
        "pushes": 13
      },
      "pushes": {
        "value": 13,
        "path": "ruullluldrrrrddlurulllddllluurrdrdluuurdd"
      }
    },
    "microban-40": {
      "rowsHash": "9b4a57bc227f1c902d38794c30303befa8b7876eb447452353c4046a942f1569",
      "moves": {
        "value": 20,
        "path": "udrruluullddurduurdd",
        "pushes": 7
      },
      "pushes": {
        "value": 7,
        "path": "udrruluullddururdldurd"
      }
    },
    "microban-9": {
      "rowsHash": "11eeab87dfea4113dc69cfe8dd4f913e98a257fbefffb813a0a23c4787750bd7",
      "moves": {
        "value": 30,
        "path": "urrdulldrdrluurdrddluruldlurul",
        "pushes": 10
      },
      "pushes": {
        "value": 10,
        "path": "urrdulldrdrluurdrddluruldlurul"
      }
    },
    "microban-56": {
      "rowsHash": "37dccabf9cc6ede3d97757eca3fbc7f03e5c0d6a0886e27a78200f5c1d0dc688",
      "moves": {
        "value": 23,
        "path": "uullulldrurdrddlluruuld",
        "pushes": 6
      },
      "pushes": {
        "value": 6,
        "path": "uullulldrurdrddlluruuld"
      }
    },
    "microban-45": {
      "rowsHash": "fdf5ff71dec8d4f54f5df0257c22f42a46210f30bdcb37f82625ecb280eff92e",
      "moves": {
        "value": 45,
        "path": "luluuurrrdlulldddrdrruluuruldddldluuurlddrruu",
        "pushes": 11
      },
      "pushes": {
        "value": 11,
        "path": "luluuurrrdlulldddrdrruluulrdddllurluuddrdrulluurrruldllddrruu"
      }
    },
    "microban-1": {
      "rowsHash": "3d7802f7f05ff3ff69e00640dafe2ec5609379bd725ec8ddcff15cceaffd038c",
      "moves": {
        "value": 33,
        "path": "dlurrrdlullddruluruuldrddrruldluu",
        "pushes": 8
      },
      "pushes": {
        "value": 8,
        "path": "dlurrrdlullddruluruuldrddrruldluu"
      }
    },
    "microban-12": {
      "rowsHash": "03c2fed7a71fb62d6d457a64c18d9298612f03560cce7a408e5c9c732a1e1c0f",
      "moves": {
        "value": 49,
        "path": "uululldrdrluurdrddrddlluruuulldrurddrrrddlludllur",
        "pushes": 11
      },
      "pushes": {
        "value": 11,
        "path": "uululldrdrluurdrddrddlluruuulldrurddrrrddlludllur"
      }
    },
    "microban-21": {
      "rowsHash": "81350c25e1abca8a9543193cbe75ce0f03667d6dd5195318f41e3b6252382cdd",
      "moves": {
        "value": 17,
        "path": "dlludluluurdrddlu",
        "pushes": 5
      },
      "pushes": {
        "value": 5,
        "path": "dllludrulluurdrddlu"
      }
    },
    "microban-51": {
      "rowsHash": "406592e1cd6982964d0787f940d78a9b52e75ef4a96bfc4632c495f3a8c1308f",
      "moves": {
        "value": 34,
        "path": "rddlluluruldlluurdldrrurdlddrrruul",
        "pushes": 8
      },
      "pushes": {
        "value": 8,
        "path": "rddlluluruldlluurdldrrurdlddrrruul"
      }
    },
    "microban-33": {
      "rowsHash": "c4ca891c27b7b5b1d1e3bdb3351a400c5f8170247679e1d6e0ea9d4aabbb7c9e",
      "moves": {
        "value": 41,
        "path": "ullrrddllluluurdlddrrudrruulllrddlluurrdl",
        "pushes": 10
      },
      "pushes": {
        "value": 10,
        "path": "ullrrddlludluluurdlddrrrruulllrddlluurrdl"
      }
    },
    "microban-27": {
      "rowsHash": "dc2555a04f9063dbe40c8890dee4c4d643661315ce5d2d2824086bd035de320d",
      "moves": {
        "value": 50,
        "path": "dlulddlluuuurrrdulllddddrruulrdrruluullldddurrdruu",
        "pushes": 10
      },
      "pushes": {
        "value": 10,
        "path": "dlulddlluuuurrrdulllddddrruulrdrruluullldddurrdruu"
      }
    },
    "microban-38": {
      "rowsHash": "ae0dde4375eadc0ce3f5610d2a08014f83fe198591eea3cbaae7ac7fff5a2056",
      "moves": {
        "value": 37,
        "path": "llluuurrrdduurrrrddlllrrrddlllullrurr",
        "pushes": 8
      },
      "pushes": {
        "value": 8,
        "path": "llluuurrrdduurrrrddlllrrrddlllulurrldll"
      }
    },
    "microban-5": {
      "rowsHash": "35ae2ed1cfa7d56f768438da50ed3538fc1fa72cb3bfd086fa33571a91829a47",
      "moves": {
        "value": 25,
        "path": "lurlldrdrdrruulldluddllur",
        "pushes": 8
      },
      "pushes": {
        "value": 6,
        "path": "luurrdlullddrddrruulldrdlllur"
      }
    },
    "microban-17": {
      "rowsHash": "6a83e1164ccdfcf3b5aca9f567ee41f328500898fea4b1a1407bc491acbb9954",
      "moves": {
        "value": 25,
        "path": "rddulldrddrruluddluuddluu",
        "pushes": 9
      },
      "pushes": {
        "value": 9,
        "path": "dldurrdulldrddluurddrruldluudru"
      }
    },
    "microban-31": {
      "rowsHash": "d56467860a0e32bc005d46d0763d1797b4656f9236b81601b0416ed6f45db1f1",
      "moves": {
        "value": 17,
        "path": "rldldrrdrruulluld",
        "pushes": 6
      },
      "pushes": {
        "value": 6,
        "path": "dldruurlddrdrruulluld"
      }
    },
    "microban-28": {
      "rowsHash": "58891443aee06035d4b4eb73e619381948c884977388eca19abb90b9a01dc538",
      "moves": {
        "value": 33,
        "path": "rdulldrddrruldluuluurrddldruuuldd",
        "pushes": 9
      },
      "pushes": {
        "value": 9,
        "path": "rdulldrddrruldluuluurrddldruuuldd"
      }
    },
    "microban-4": {
      "rowsHash": "afaeaf802d79a148432736c2251c7ff730ce79c01021e4e24264794f8fd2fc78",
      "moves": {
        "value": 23,
        "path": "ulldldruurrdllrrddlurul",
        "pushes": 7
      },
      "pushes": {
        "value": 7,
        "path": "ulldlurrrdllulllddrrrurrddlurul"
      }
    },
    "microban-46": {
      "rowsHash": "da858c430438ccc65db07247e6fa196ab2a2f32be5d6be0a659f71ca821ef8a9",
      "moves": {
        "value": 47,
        "path": "dlluururdrudlllddrrudlluururrdlddlluuluururrrdd",
        "pushes": 8
      },
      "pushes": {
        "value": 8,
        "path": "dlluururdrudlllddrrudlluururrdlddlluuluururrrdd"
      }
    },
    "microban-22": {
      "rowsHash": "508fc043a3ddc092392089e2263001e1c9a8f5b2f246bde992f1ba4bd91310cb",
      "moves": {
        "value": 47,
        "path": "drrruuldldluuulurrdlddrrrdlldluuuuruldddrruruul",
        "pushes": 15
      },
      "pushes": {
        "value": 15,
        "path": "drrruuldldluuulurrdlddrrrdlldluuuuruldddrruruul"
      }
    },
    "microban-20": {
      "rowsHash": "52d06c2850b7bfd8e140401cc3e9cabc31c5228c6a56bf467b58d6c02e548617",
      "moves": {
        "value": 50,
        "path": "urdddrrruullllrddlddruuudrrruullulldrrrlulllldrrrr",
        "pushes": 16
      },
      "pushes": {
        "value": 16,
        "path": "urdddrrruullllrddlddruuudrrruullulldrrulllldrrurrdrlulldrr"
      }
    },
    "microban-52": {
      "rowsHash": "19cd5817f0e247099708eb0cb5de60f79fca589aac865a69765d50ceeebb9bd5",
      "moves": {
        "value": 26,
        "path": "ddlruuldldrllddrulurddrdru",
        "pushes": 8
      },
      "pushes": {
        "value": 8,
        "path": "ddlruuldldlddrrlluurrllddrrudllurdrdru"
      }
    },
    "microban-18": {
      "rowsHash": "acfaa3ef010fc80ae7f3442c7ec1f31bb89b6c1237a0090555d3d165cea7a49e",
      "moves": {
        "value": 71,
        "path": "ruuuulllddrrdruudllluuurrrrdldddddluuruuululldddrrdruudllluuurrdlurrrdl",
        "pushes": 13
      },
      "pushes": {
        "value": 13,
        "path": "ruuuulllddrrdruudllluuurrrrdllrdddddluuruuuullldddrrdruudllluuurrdlurrrdl"
      }
    },
    "microban-13": {
      "rowsHash": "00f9ee4279ec6d93c86538bb2b29f0da280bc758f0535c3587150e998e3ef708",
      "moves": {
        "value": 52,
        "path": "rdlddrddluuuuruldddrdrrulldluuuludrrddrdldluuurulrul",
        "pushes": 23
      },
      "pushes": {
        "value": 21,
        "path": "rdlddrddluuudrdrruldlluuurulddddrruldluuurdlddrruldluruulludrrddlurulrul"
      }
    },
    "microban-19": {
      "rowsHash": "4c7c39d0fed8fc9b452c301f47b77e99f251774ebbffa8ea19f4096c43f09a85",
      "moves": {
        "value": 41,
        "path": "urrdddlddruuuurullldrurdddlddruuuullllurr",
        "pushes": 20
      },
      "pushes": {
        "value": 20,
        "path": "urrdddlddruuuurullldllurdrrurddulllurdrrddlddruuuu"
      }
    },
    "microban-15": {
      "rowsHash": "a77a41607c1494e3e8efe509901adc0d39fa46a2f0670adc4c00f5b1e34ecbf6",
      "moves": {
        "value": 37,
        "path": "drdddlluuddrruulullldllurrrrdrrddlluu",
        "pushes": 14
      },
      "pushes": {
        "value": 12,
        "path": "drdddlluuddrruuulllldllurrrrdddrruulrddlluu"
      }
    },
    "microban-55": {
      "rowsHash": "552c48de07c74c0da14e1a7f7333fd682a62508a9ca0e134f07b68a1a3fb966b",
      "moves": {
        "value": 64,
        "path": "rdrrrddlurdddluuruulllulldrrrrurdddldrrlulurulllulldrrrrurdddldr",
        "pushes": 27
      },
      "pushes": {
        "value": 27,
        "path": "rdrrrddlurdddluuruulllulldrrrrurdddlurulllulldrrrrurddlddrrlluurdldr"
      }
    },
    "microban-50": {
      "rowsHash": "fd889e6f49cb30950e8d996fe1b831d85f7cb93519c19bc1c2c849b872e281fa",
      "moves": {
        "value": 76,
        "path": "llulddulldrrrurrrrdddllllluururrdlluldllurrrdrrurrdddllllluururrrldllllurrrr",
        "pushes": 23
      },
      "pushes": {
        "value": 17,
        "path": "llulddulldrrurrrrrdddllllluulurrldddrrrrruuulldllrrurrdddllllluururdlllurdrrurdlllurdrrurldllurr"
      }
    },
    "microban-26": {
      "rowsHash": "887fa70c4475c028fce14e71c0dc8814cd958984d33a62e0e586034a71698eae",
      "moves": {
        "value": 41,
        "path": "rdddlurdddluulldrurrddlurulruuulldrduurdd",
        "pushes": 10
      },
      "pushes": {
        "value": 10,
        "path": "rdddlurdddluulldrurruuulldrdrdlrddluruuluurdd"
      }
    },
    "microban-34": {
      "rowsHash": "0d50560cf65e10bc5e9bc46a25b1716f451236a264dfa529cf73a5afce576423",
      "moves": {
        "value": 30,
        "path": "drudrrurlluurdldrdlllurlurrurd",
        "pushes": 10
      },
      "pushes": {
        "value": 8,
        "path": "drrrurdlllluurrurdrddllurdlllurururd"
      }
    },
    "microban-11": {
      "rowsHash": "6a7b518466eb682662cf6c11d4a6379ef79f3d369d087bf487fa35c29230325b",
      "moves": {
        "value": 78,
        "path": "ulllddddrrrrululdrdllluuuurrrdddldllullddrulurdrrrurrdllllullddrurrruuruullldd",
        "pushes": 18
      },
      "pushes": {
        "value": 16,
        "path": "ulllddddrrrruldllluuuurrrddldurrddlluurdldllullddrulurdrrrurrdllllullddrurrruuruullldd"
      }
    },
    "microban-48": {
      "rowsHash": "8b1141dee7466e45cf907fe3788a0bdaf4368636b8bff82a6a1fc5660203c63e",
      "moves": {
        "value": 64,
        "path": "rdddlruuullddlddruudrrurdrddlurulllruuulllddrdrrrddlurullruuulld",
        "pushes": 14
      },
      "pushes": {
        "value": 14,
        "path": "rddrduldlrrrddlludrruululuullddlddruluuurrrddrdrdluuluulldlddruluurrrddrdllrrddluruluuulllddrduluurrrdddlruuulld"
      }
    },
    "microban-8": {
      "rowsHash": "2647a6583cfbf71982580c7ae9c7aff1ec8b67a4d5232893b5ef430d6d62399c",
      "moves": {
        "value": 97,
        "path": "llddddddldddrruuluuuuuuurrdlulddddddlllddrrudlluurrdddrruuluuuuuulurdddddddrddlluudlluurrdruuuuuu",
        "pushes": 32
      },
      "pushes": {
        "value": 32,
        "path": "llddddddldddrruuluuuuuuurrdlulddddddlllddrrudlluurrdddrruulrddlluuruuuuuulurdddddddldlluurrdruuuuuu"
      }
    },
    "microban-39": {
      "rowsHash": "5e6d1caddb446b1732426214793ebbd35b823605d39952e81374a1765ec285fc",
      "moves": {
        "value": 85,
        "path": "ruullluullddrluurrddrrrddlurullluullddrrddllddrruuuurrurdllllluurrdullddrrrrdruddrrul",
        "pushes": 27
      },
      "pushes": {
        "value": 27,
        "path": "ruullluullddrluurrddrrrddlurullluullddrrrrurdlllddllddrruuuulluurrdullddrrrrdruddrrul"
      }
    },
    "microban-14": {
      "rowsHash": "01f9dc2e98af3b5712a8361ba81c1695158a308843a8d99d147f7e98cd152880",
      "moves": {
        "value": 51,
        "path": "uullllddrdrulluurrrrddlllrrruulldurrddlldllurruulld",
        "pushes": 10
      },
      "pushes": {
        "value": 10,
        "path": "uullllddrdrulluurrrrddllldlurrrruulldurrddlldllurruulld"
      }
    },
    "microban-23": {
      "rowsHash": "1427023160f538795edcfb6d054f53235618fe565dbe5214f61297b3725781a4",
      "moves": {
        "value": 56,
        "path": "ruullurdrdddlluudrruululldrddrruurullrdddlluururddulllur",
        "pushes": 10
      },
      "pushes": {
        "value": 10,
        "path": "dlurruullurdrddlludrruululldrddrruurullrdddlluururddulllur"
      }
    },
    "microban-58": {
      "rowsHash": "5c4fa3619d3384e5aadc0c054b53a0964a61e524317fd6f96fd5295173507cc1",
      "moves": {
        "value": 44,
        "path": "luluurdrdulldrddrruruulllrrrddlluddlurrruull",
        "pushes": 11
      },
      "pushes": {
        "value": 11,
        "path": "luluurdrdulldrddrruruulllrrrddlluddlurrruull"
      }
    },
    "microban-61": {
      "rowsHash": "bf823a4f018c362dfb727766c402eeb4e433b21b5000fcae92339c96ef53884f",
      "moves": {
        "value": 100,
        "path": "lddlddrruldluruuuruullllldddddrrrdruuuddlllluuuuurrrrrddllrdddrruldluuddlllluuuuurrrrrddldddllurdruu",
        "pushes": 21
      },
      "pushes": {
        "value": 21,
        "path": "lddlddrruldluruuuruullllldddddrrrdruuuddrruldllllluuuuurrrrrddllrruullllldddddrrrruuddlllluuuuurrrrrddldddllurdruu"
      }
    },
    "microban-42": {
      "rowsHash": "6e143758d4f876a913f5eca6817c87621d73774b46703bc3fae8d5ce113a7766",
      "moves": {
        "value": 47,
        "path": "rddllddrulururuuldddlddruruuldldrdllluurrruuurd",
        "pushes": 17
      },
      "pushes": {
        "value": 15,
        "path": "rdddldllluurrruruuldddlllddrrruruuluurdlddlllddrrudlluurrrldr"
      }
    },
    "microban-10": {
      "rowsHash": "b0c22f40a20d0a0dec4a9d47265c163ccf29412049cdf1c3030b2d212440d865",
      "moves": {
        "value": 89,
        "path": "rddrruullrrddrruuuuurrdddlruuulldddllddrruuuuddddlllluurrrlddrruuudddlllllluurrrrrlddrruu",
        "pushes": 21
      },
      "pushes": {
        "value": 21,
        "path": "rddrruullrrddrruullrruuurrdddlruuulldddllddrruuudddlllluurlddrrrruuuuddddlllluurrrlddrruuddlllllluurrrlddrrrruuudddlllluurrrlddrruu"
      }
    },
    "microban-43": {
      "rowsHash": "6afff6b6a8e634d9534b8c0bdfd8ba1bcb3e1086de21a96505dfa57afcfefb2e",
      "moves": {
        "value": 61,
        "path": "dddllldldllururrrrdruudllldlddruulurrrurdlllddllulurrrrruuurd",
        "pushes": 24
      },
      "pushes": {
        "value": 22,
        "path": "dddllldldlluurrrrrlldldlurddruluurrrdruudllllddrulurdlllurdrrurrurdllldllurrrruuurd"
      }
    },
    "microban-6": {
      "rowsHash": "903be36b47c899c0a8419cf0ac9e019ac2b8b27415438c264d02cde8da06d470",
      "moves": {
        "value": 107,
        "path": "ulldlllluldulldrrrrrrdrrruulldurrddllllulllllddrulurrrrrrdrrruulldurrddlllulllllddrulurrrrrdrrruulldurrddll",
        "pushes": 29
      },
      "pushes": {
        "value": 29,
        "path": "ulldllllulllddrluurdrrrllllddrrudlluuurrrdrrrlllulldrrrrdrrrruulldurrddllllullllldrdruluurrdrrrdrrruulldurrddlllulllulldrrrrrdrrruulldurrddll"
      }
    },
    "microban-62": {
      "rowsHash": "405afcc30e37d9c86ca0494a0c8ac125df13e12a14a8fa1d0f1a8cde0f1d1cf3",
      "moves": {
        "value": 64,
        "path": "llllulldrrrlldlllrruuldlddlluurrrrrrllllddlulurrrrrdllldlulurrrr",
        "pushes": 32
      },
      "pushes": {
        "value": 30,
        "path": "llllulldrdlllrruuldlddlluurrrurrdrldllururrdrlulldllllddrrudlluurrdrrurdlllurllldrurrurrdrullldrlllddrururrdllllurrr"
      }
    },
    "microban-16": {
      "rowsHash": "4f042102dcb99107a483acf9abe07dc291a8c16330ac079531009446841b8527",
      "moves": {
        "value": 100,
        "path": "lddrudrrulldluuurullluldddldruuurrrrdrdldluurullluldddlddrruldluruuurrrrddddrrulldluuurulllulddddldr",
        "pushes": 39
      },
      "pushes": {
        "value": 39,
        "path": "lddrudrrulldluuurullluldrrrrdrdullddruluullldurrrddrrulullllddrdldluruuurrrrddlurulllulddurrrrddddrruldluuluulllddrddllurdruluuurrrddrruldlurulllulddddldr"
      }
    },
    "microban-41": {
      "rowsHash": "4759a62d5384237a9b56ef0ae79323b78ce1909e778f6566563f1d79a957f82d",
      "moves": {
        "value": 50,
        "path": "urdurrdlrrddluruulldrurdulllldrrrdrdlllulurrurdurd",
        "pushes": 15
      },
      "pushes": {
        "value": 13,
        "path": "urdurrdulldrurrdddllluluurrdrullldrddrrudlluuurrrdullldddrruruuldulldrrurd"
      }
    },
    "microban-32": {
      "rowsHash": "c4f23fc3f5d3c75c8fe1dfe65a6a0de20fadb1070a37bd065e0bd0396ceb3144",
      "moves": {
        "value": 35,
        "path": "ulldullddrururrdlllddruluruuldrrrdl",
        "pushes": 9
      },
      "pushes": {
        "value": 9,
        "path": "ulldullddrururrdlllddruluruuldrrrdl"
      }
    },
    "microban-53": {
      "rowsHash": "17a15303c2bed92a48dad31179741f983a1a8eac56f50d864545befe114e2505",
      "moves": {
        "value": 37,
        "path": "ruruululldlddruudddrruuulrdddllurdruu",
        "pushes": 12
      },
      "pushes": {
        "value": 12,
        "path": "luluururrdrddldlluuddrruuudddlluuudddrruldluluurrllddru"
      }
    },
    "microban-49": {
      "rowsHash": "7885acc304bd26047e6fb45fd6b30d8463514747ee50cad0baece15a7c6c182e",
      "moves": {
        "value": 82,
        "path": "lddrldruluurdduurrddldddldrrluuuuruulldlddrluurdrdddlddrrulrdrruldlluuuuulldrurddd",
        "pushes": 21
      },
      "pushes": {
        "value": 21,
        "path": "ldddrluuurrrddldddldruuullurdrdddrluuululuurddldruuurrddldlluurdrdddlddrrulrdrruldlluuuuulldrurddd"
      }
    },
    "microban-57": {
      "rowsHash": "6b04dae538be32196fcdb285c5400fcc668eb10ab8dd37d861fa185a236c6b26",
      "moves": {
        "value": 60,
        "path": "dddrdrrulldlulldrrruluuruulddddldrurrrddlurullldrurdllllurrr",
        "pushes": 23
      },
      "pushes": {
        "value": 23,
        "path": "dddrdrruldllrruldlulldrruuudddruluuruulddddldrurrrddlurullldrurdllllurrr"
      }
    },
    "microban-47": {
      "rowsHash": "f2e4bec28a8e38101c1231c0d72f82d80e1e16d17ed90b9826f2c9e89db43a6c",
      "moves": {
        "value": 83,
        "path": "rrruuulldrrddlllluurrrurddullllddrrrrrrdrrullllllrruuurrdlulddulllldddrrurrlldllurr",
        "pushes": 22
      },
      "pushes": {
        "value": 22,
        "path": "rrruuulldrrddlllluurrurrrrdluldduulldllddrrrrrrdrrullllllrruuulldrurddulllldddrrurrlldllurr"
      }
    },
    "microban-37": {
      "rowsHash": "bda1bc6266ccc047f10dc30ce83a72235fdd7b49e7a6f6d0e5491ea0c36b68f2",
      "moves": {
        "value": 71,
        "path": "drruullulldrrrlddrruuuuddllullullddrrrrrlddrruuudllulluldldrrrrrlddrruu",
        "pushes": 23
      },
      "pushes": {
        "value": 23,
        "path": "drruullulldrrrlddrruullullullddrrllurdrrrddrruuuuddddlluurlddrruuudllllluurdldrrrrlddrruu"
      }
    },
    "microban-54": {
      "rowsHash": "346e617aff125c21479971f45350240a7a6e1543b6b3e8e86d9d058521aac661",
      "moves": {
        "value": 82,
        "path": "druruuldrrrrdruudllllddllulurrrrrrrllllddlulurrrrrdrruuldurruuldrdldlllllddrulurrr",
        "pushes": 30
      },
      "pushes": {
        "value": 30,
        "path": "drururrrdruuruulldrddlllluldrddllulurrrrrrdruudlllllldrdrrudlluurrrrdrruuldllllldrurrrrurruuldrdldlllllddrulurrr"
      }
    },
    "microban-79": {
      "rowsHash": "6ac589c7f2409721e442478b9c81f412f0606f3457861c947e1219f99a1dfccb",
      "moves": {
        "value": 48,
        "path": "llldllurrrrrlllluurrrdullddrrdrrulllrrrruuldrdll",
        "pushes": 18
      },
      "pushes": {
        "value": 18,
        "path": "llldllurrrrrlllluurrrdulllddrrruullddrrdrrulrruuldrddllullrrdrrull"
      }
    },
    "sasquatch-1-8": {
      "rowsHash": "0753a02d0f7e60091a8ae33d7d46d6da9f633ad448a3df5c46fff54c8df950b0",
      "moves": {
        "value": 133,
        "path": "urrrrrddlluruuurrrrdrddrddddlluurdruddldlulllllulululuurdrurrddrruulluurrrrdrddddldrddlulllllulululururrlldddrdrdrrrrrruuuuuululllldd",
        "pushes": 23
      },
      "pushes": {
        "value": 17,
        "path": "drdrdrdrrrrruurlddlllllulululuurrrruurrrrdrddduuulullllddllllddrdrdrdrrrrrrruudldllllllulululuurrrrrddlludrruuluurrrrdrddddrddlllllllulululuurrrdrlulllddrdrdrdrrrrrrruuluuuulullllddllldurrruurrrrdrddddldrddluruuuuuulullllddllldrurruurrrrdrddddddllllllulululur"
      }
    },
    "sasquatch-2-34": {
      "rowsHash": "a7bbe492f4ea737ad1fc1cd6bb68027af2fbf8deca7c9383dce24a1870bd697a",
      "moves": {
        "value": 68,
        "path": "rulrdrrulrurrddllluldrrrddlluuruldllllldrldlluurrrrrlllluurrdullddrr",
        "pushes": 22
      },
      "pushes": {
        "value": 22,
        "path": "lllrrdrulllddlluurrdrrllurdrullluurrddldrurrrrrulrurrddlllllrrrrddlludrruull"
      }
    },
    "microban-63": {
      "rowsHash": "4188dcfdf556771fd611cef65cedff47a4c5464461bb55a936709f935017e51a",
      "moves": {
        "value": 101,
        "path": "llllllulllllllulldrurdrrrrrrrddlurulllllllulldrrrrrrrrurdllllllddlurululldrrrrrrrrdrudrrrrrdrrullllll",
        "pushes": 50
      },
      "pushes": {
        "value": 50,
        "path": "llllllulllllllulldrurdrrrrrrrddlurulllllllulldrrrrlddlururrrrlllllrrrrrrurdlllllllulldrrrrrrrrdrrrlludrrrrrdrrullllll"
      }
    },
    "sasquatch-5-13": {
      "rowsHash": "75b29203d5a1c5511aa3fa4b68726047c8a8db0491d766b4a3df62971279cd8e",
      "moves": {
        "value": 112,
        "path": "rurdlldddrruurrdlululuurdldldrrllddrrurruuulrdrrulldddruluurruulldddurrdlddllldlluuuruurrlldddlddrrurrruuuruulld",
        "pushes": 20
      },
      "pushes": null
    },
    "microban-60": {
      "rowsHash": "8381e60304c74b57e88bd896867911e57c6968c2dd9cace7a9559ff081a486a0",
      "moves": {
        "value": 169,
        "path": "urrrrrrdddllulldrrrllddrddluuuddlldllurrrlluuluurddduuuuurrrrrrddddduullulldrrrllddrddluuuddlldllurrrlluuuuuurrrrrrddddullulldrrrllddrddluuuddllluuuuuurrrrrrdddllulldrrr",
        "pushes": 44
      },
      "pushes": {
        "value": 44,
        "path": "urrrrrrdddllulldrrrllddrddluudlruuddlldllurudrluuluuruurrrrrrddddduuuuullllllddlddrddrrlluuluuruurrrrrrdddllulldrrrllddrddluuuddllluuluuruurrrrrrdddduuuullllllddddduuuuurrrrrrdddllulldrrrlldddlldllurrrlluuuuuurrrrrrdddlllddrddluuuddllluuuuuurrrrrrdddllulldrrr"
      }
    },
    "sasquatch-7-5": {
      "rowsHash": "ab3eb1703127b7a45a28f724b4d16b9a5d4dc332600e07f93b1781f69e64a9e3",
      "moves": {
        "value": 105,
        "path": "rrdrrddrdllrrrruuulluldddrrlluullulldrddrrddlururuullulldrddldllurdrrrdrurrdrulluuullulddduurrrdddlllldlu",
        "pushes": 33
      },
      "pushes": null
    },
    "microban-29": {
      "rowsHash": "6224c114d9a9e7fb60e4d3137805ec9d3d82737d42601cd2f57182871a4d3172",
      "moves": {
        "value": 104,
        "path": "ullldrurrdrrddllllllluururrdrrrlulllldrrlllddrrrrrrruuuuddllulldrrrllllllddrrrrrrruuuruulddduuuulldrurdd",
        "pushes": 22
      },
      "pushes": {
        "value": 22,
        "path": "ullldrurrdrrddllllllluururrdrrulllldrurrrdrlullldrlllddrrrrrrruuuuddllulldrrrllllllddrrrrrrruuuruuldduuulldrurdrddlduruuld"
      }
    },
    "microban-96": {
      "rowsHash": "8e7509b46c808dd684918d375d18516f65f00ff5318aad2f10ff38027512d7c4",
      "moves": {
        "value": 92,
        "path": "rrdrrulllrrdddlldlluruuuuuruldddllulldrrrrrrdrrulllrrdddlldllurrrlluuuuuruuldddduuuulldrurdd",
        "pushes": 37
      },
      "pushes": {
        "value": 37,
        "path": "rrdrddlruurulllrrdddlldlluruuuudlruuddllrruuruldddllulldrrrrrrdrrullrdddllrruuullrrdddlldlluruuuuddddrrlluuuuuruulddduuulldrurrddldduuruuldd"
      }
    },
    "sasquatch-4-5": {
      "rowsHash": "bf6abb1780d0e52894c53fee92da579aee145e73439217a14658d88a12b431b6",
      "moves": {
        "value": 40,
        "path": "uuludrruluulldrurdddllururdrdrrullrulrul",
        "pushes": 19
      },
      "pushes": {
        "value": 19,
        "path": "uuludrruluulldrurdddlludrrrrrululrddllllurdrrruuulddrdl"
      }
    },
    "microban-35": {
      "rowsHash": "30c54ddb96b05445a4cc7719d761a82c50af39c3f74117b25a7858e0bf9f401e",
      "moves": {
        "value": 77,
        "path": "lluluurdrdlddrruldluurululuurdrdlrddlddrruldluuuuruluurdddddlddrruldluuuuurul",
        "pushes": 31
      },
      "pushes": {
        "value": 31,
        "path": "lluluurdrdluuluurdrddluddddrruldluuuruulrdddldluruuddddrruluuulludrddlurrdddluruluurulddddluruuuuurdddddlddrruldlurul"
      }
    },
    "sasquatch-6-2": {
      "rowsHash": "50db7470133ebf6ef09845ca926cdcb4413f87fbdf3a46799121866af5ea74b9",
      "moves": {
        "value": 100,
        "path": "ululluurrddldrdrrullrrrruruullldduurrrddldlluulrurrdllddrrurulluldrrddlldlluulldruluurrdrrduurrdluld",
        "pushes": 23
      },
      "pushes": {
        "value": 23,
        "path": "ululluurrdullddrdrrrrruruullldurrrddldllllluluurrddldrdrrullrrrruruullldduurrrddldlluuurrdulldlrurrdllddrrurulluldrrddlldlluulluurrdrrduurrdluldllulldddr"
      }
    },
    "sasquatch-7-8": {
      "rowsHash": "f0545c5b7cb069b00608db4b33c2e5319ab0ceedecc8f2b64c1dfa93911d2040",
      "moves": {
        "value": 42,
        "path": "udldllulldrururrdrrdluluuurrdluldulldllurr",
        "pushes": 12
      },
      "pushes": {
        "value": 12,
        "path": "ldlluuddrrurudldlluurrdrrdlululldlldrururruurrdlullldurrdulldllurr"
      }
    },
    "microban-87": {
      "rowsHash": "e3bd9089362ab5ce8cb5a5bb48677bc99ec6a9dbc730a887aeafe8398ada72dd",
      "moves": {
        "value": 149,
        "path": "lurluurdllluruulurrrrdrruuldrdlllullddddrruldddrudrrulldluluuuulurrrrdrruuldrdllullldddrrdlddrruldluluuuulurrrrdrruuldrdlulllldddrrdldluuuulurrrrrurd",
        "pushes": 53
      },
      "pushes": {
        "value": 53,
        "path": "lurluurdllluruulurrrrdrruuldrdllulldldddrruldluuulurrrldlddrdddruluuluuurrrdrruuldllldlddrddrdrrulldluluuuuurrrdlulldddrrdulluuurrrrrdlulllldddddruluuuurrrrdlulllddddrruldluuulurrrlldddrdddrruldlurululuuurrrdrruuldrdlulllldddrddluuuulurrrrrurd"
      }
    },
    "sasquatch-5-2": {
      "rowsHash": "1e79f52c92fc5bb0e68d161db511e7d2dcedf8f2b6c8de0045392f421c70bb0b",
      "moves": {
        "value": 91,
        "path": "ldrrddddllluurrllddrrurrruuullddldruuulddrddllluurrllddrruruddllluurruurrrdddlruuulllulldrr",
        "pushes": 20
      },
      "pushes": {
        "value": 20,
        "path": "ldrrdddrruuulrdddlldllluurrllddrrrurruuullrrdddlldlurrruuullddldruuulddrddllluurrllddrrruuluurrrdddlruuulllddllddrrudlluurruuulldrr"
      }
    },
    "sasquatch-7-20": {
      "rowsHash": "460f3a139017d20d05c68de5757b1a811169ae2092a88d35709603dfe536a5a6",
      "moves": {
        "value": 80,
        "path": "uuruulddllurdrruuluurdlddrrruullulddullurdrrrruuuruulddddrdlldrdlulurruuuulllldd",
        "pushes": 25
      },
      "pushes": null
    },
    "sasquatch-5-1": {
      "rowsHash": "8112c13197e2b4fcef665f6f187321a8d73b13652113aae4f2b78beb7c9de2c7",
      "moves": {
        "value": 112,
        "path": "rdluuuuulldrurddddllurdrrddluruluuuruldlluurdldrurddddrruldlulldrrrddlurulullddrruluruuruldlluurdldrurdddrdlddru",
        "pushes": 39
      },
      "pushes": {
        "value": 39,
        "path": "rdluuuuulldrurddddllurdrrddluruluuuruldlluurdldrurddddrruldlurdddluruuluuddllddrrdruruulluuruldlluurdrddddrlluruuulldrurdddlddrluurrdlddru"
      }
    },
    "microban-59": {
      "rowsHash": "9f7af6fb95b0eab77c2aaee269c9d8802b3d6cad87c8a188f6e510203d8ce2d4",
      "moves": {
        "value": 178,
        "path": "dlllllldddlururrurrruullllllllddddrrdrullluuuurrrrrrrrddlllllldrdluurrrdlullddrulurrrrrrurdddrddllurdruuluuuulllllllllddddrrdruulurrrrrrurdddrdluuulldlllullddrulurrrrrrurddduurdd",
        "pushes": 52
      },
      "pushes": {
        "value": 50,
        "path": "dlllllldrrllddluruurrrrruullllllllddddrrdrullluuuurrrrrrrrddlllllldurrrrrruullllllllddddrrurlddruulurddllluuuurrrrrrrrddllldlrurrruullllllllddddrruurrrrllllddrulurdrrurrrllldllurdldllluuuurrrrrrrrrdddulldllrurrrdduuuulllllllllddddrruurrrdlrrrurrrddddllurdruluuulldllulllddrulurdrrrrurrdddruluulldllurrrurdddrdluuurdullldllllurrrdllldllluuuurrrrrrrrrddrdduuluulllllllllddddrruurrrrrrurddd"
      }
    },
    "sasquatch-4-7": {
      "rowsHash": "12b4ce4ab02e164fb329372007295c7f449d658a1460825e223b58615c47b3f4",
      "moves": {
        "value": 202,
        "path": "dllllluurrrrudlllluurduuurrrrrrrrddlllllllrrrrrrrrddlllludrrrruulduuullllllllddrrrrrrrllddrrrurrruulullddlllllllluurrrrrrrlllllllddldlluururldlddrrdddrrrrrrrrrruulllluullddlllrrruurrddrrrrddlllllllllluu",
        "pushes": 20
      },
      "pushes": null
    },
    "sasquatch-7-7": {
      "rowsHash": "c295bc178b5b6851e0071359d4e9bce378c5c85e841ce287cca68c450ec37982",
      "moves": {
        "value": 75,
        "path": "ullluurdldrdrruulluldulldrruruuldrddllururrrdrdlddllluurudllurdddrrruuldrdl",
        "pushes": 22
      },
      "pushes": {
        "value": 18,
        "path": "ullludrrrudllluurdlddrrurulddllurluururrdulldllldrurrurrdrdlddlluludrdrruuuullddllurdddrrruuuulluldrrrddddllluurudllurdddrrruuldrdl"
      }
    },
    "microban-65": {
      "rowsHash": "abedb3c1735d5b7f84da7fd5f55024f9a05b1562580ff962460b93317127157b",
      "moves": {
        "value": 138,
        "path": "uuuulrddddlluururddullddrdrrulllldlurulurrruruuldulldrrdrddullddrdrrulllullddruluurrrurddullddrdrrullluuruuurddddulllldrlddrurrdrrulllldlu",
        "pushes": 45
      },
      "pushes": {
        "value": 41,
        "path": "uuuulrddddlluururdduuuuldrddllddrdrrulllullddruruurruulduulldrurrdddddlluururduuulldrdrddulldllrrdrdrrulllullurdlddruluurrrllldrurrurddulllddrrdrrulllrruuuluurdlddlldlddrurrruuluurdddullllddrrrdrrulllldlu"
      }
    },
    "sasquatch-4-10": {
      "rowsHash": "e63c482cabb2ff113d4cbf10d2dac99e9c317a7fc79a95bc4ee99c4548659d6a",
      "moves": {
        "value": 83,
        "path": "dluulllddrurlluurdldruuluururuulduullddrddddrddluurdrrrddlulrrulruulddrdlullulduuuu",
        "pushes": 27
      },
      "pushes": {
        "value": 27,
        "path": "dluulllddrurlluuuururuulrddldlddrdldruuluururuulduullddrddddrddluuuuddrdrrruuldrdllrrddlulrruuldllrrrdlullulduuuu"
      }
    },
    "microban-100": {
      "rowsHash": "422a088d18efa81c01526e3fafae6e28cb95fd52aa7eaf33f1f748abe9655467",
      "moves": {
        "value": 155,
        "path": "lddrduluurdrrrdldddrruulrddlluurrdluuullllddrudlddruuluurrrurdddlurdrddlluurrdluuullluldddrulurrrurdddlurulllulddurrrrddrddlluuurullluldrrrrddrdldluuurulll",
        "pushes": 52
      },
      "pushes": {
        "value": 52,
        "path": "lddrduluurdrrrdldddrruulrddlluurrdluuullllddrulurrrurddulllddlddruluuurrrrdduullldlddruluurrrrddlurulllrrrddrddlludrruuluulllulddurrrrddrddlluurrdluuullllddrulurrrurdddlurulllulddurrrrddrddlluuurullrrddrdluuulllrrrddddluuruullluldrrrrddlurulll"
      }
    },
    "microban-89": {
      "rowsHash": "e010a08b215e3eb6bd07a40c3a07bc271a9e09cc77240a5ad27b494de639934a",
      "moves": {
        "value": 146,
        "path": "ddddruluuuurrddlruullddddrdldlluuuuurldddddrruuuurruulldddduuulllulldrrrrldddddrrruuldldluudrruuurruullddddruddlldlurruuuuurrddlruullddddrdllrrdll",
        "pushes": 35
      },
      "pushes": {
        "value": 35,
        "path": "ddddruluuuurrddlruullddddrdldlluuuuurllulldrrrdddddrruuuurruullddddrddllluuuuurldddddrrruuldldluudrruuurruullddddruddlldlurrrdluuuuuurrddlruullddrddddllururuulddrdll"
      }
    },
    "sasquatch-7-9": {
      "rowsHash": "af24c1c67d51a8e28fc5d8a14ac2469ca857b42216246b037dae440f5bc5d7e9",
      "moves": {
        "value": 87,
        "path": "drdrulluurrrrurrdddllllddrullluuurrddrdluuullddrluurrddrddluulldruluurrrruuldrrrdddlluu",
        "pushes": 20
      },
      "pushes": {
        "value": 14,
        "path": "urrrrurrdddlllrrruuulldlllldddrrdrullluuurrdduurrurrdddllldlurrrruuulldllllddrldrurlluurrrruuldrrrdddlluu"
      }
    },
    "sasquatch-4-1": {
      "rowsHash": "7c625f0b497c4a8cb1132358df69939d1a9fa2d019b4571683a64ddd5c3f1e44",
      "moves": {
        "value": 127,
        "path": "uuuluurddddrrruuldrdllddllurdruluuuururrddlddruluruulldllurrrurdddrurrddlulllddrulurrrdrrululdllddlldluuuulurrrurddrldlddrulurr",
        "pushes": 49
      },
      "pushes": {
        "value": 43,
        "path": "urrrudllluuluurddddrrruuldrdllddlluruuuluurrrrdullllddrddrruurddllluuulurrdldddrruurrurrddluruldllddllluuuurrurddulldldddrruurddlllddruluuuuurrrddddllruurrrllddlldluudrruurrrurdlllurdlddllluuulurrrurddrdrrrdlullululldldddrruurr"
      }
    },
    "sasquatch-1-20": {
      "rowsHash": "19b969bfb7100a1edc551c3475d9986762615336a65198b4e9bd448c073069a9",
      "moves": {
        "value": 90,
        "path": "ulldddrrrlurruulldrurdrdurulruuldddllddllluurrrurrdrullldrrllddllulurrrrlddlulurrlllurrrrr",
        "pushes": 36
      },
      "pushes": null
    },
    "sasquatch-6-3": {
      "rowsHash": "6ccb18cad87a562a72ce22253f905b5d03efe9ea34d32f11a018bc386d12fe9f",
      "moves": {
        "value": 84,
        "path": "ulullllldrurrdddrdllruuldlurrdddluruuuurrdlulllldlddrdrrdruruuddlllluluururrrrrdrddl",
        "pushes": 16
      },
      "pushes": null
    },
    "microban-69": {
      "rowsHash": "de1c7bfd221bba9f005f3f185d59fcfbb92cf37da4e445787141fa1f818f857e",
      "moves": {
        "value": 125,
        "path": "urrrurrrdrrddlluurullluldrrrrdrdldluurullldllrrddllluuudrrruuldrrruurdddrdldluurullldllrruuldrdddllluluurdrrlluluurddldrdldrr",
        "pushes": 39
      },
      "pushes": {
        "value": 37,
        "path": "urrrurrrdrrddlludrruuludrddlluurullluldrdllrurrruurddllldddllluurrurrrdddrruulrddlluurullrrdrdluullluldrrrrdddluruullldlrddllluuudddrrruuurrrddlurullldllrrddllluluurdrrruuldrdddlllluurdldrrluuuluurdlddrrrllluurdldr"
      }
    },
    "sasquatch-1-15": {
      "rowsHash": "0922316f74e431f2a9a751575bd7d5f5b59a6a728c5127be0f6e50b61a18d58c",
      "moves": {
        "value": 156,
        "path": "dddrudlddrdddrruuuuurrddlruullddlluluurddllddruudrrrdddlluuddrruuulluuullduruurddddlurddrrdddlluuluuddrddrruuulldlullldrrrurrruurrddlllllrrrdddlluuddrruuull",
        "pushes": 42
      },
      "pushes": null
    },
    "microban-77": {
      "rowsHash": "4a7157aaf65e236df8f1646f9fe067b2038d3047ac11a1c792e203d18cc6a375",
      "moves": {
        "value": 189,
        "path": "ddddrrurrrulrdrruldllllldluuururrrrrddrdlllurdlllurrdlldlluuururrrrrddrdlllurlllddlluuururrrrrdduullllldllurrrrrllldldddrruldluuulurrrrlldlddrrurrdllldluuulurrrldlddrrurrrrrdlllllldluuulurr",
        "pushes": 55
      },
      "pushes": {
        "value": 55,
        "path": "ddddrrurrrulrdrruldllllldluuururrrrrddrdlllurdlllurrdlldlluuururrrrrddrdllruuullllldldddrruurrrlldldlluuururrrrrdduullllldllurrrrlldldddrruurrrdlullddlluuuurrrrllldldddrruldluuulurrrldlddrrurrdllurrrrrdlulldlldlluuuurrrlldldddrrulrurrrrdllullddlluudrrurrdlldlluuulurrdldddrruldluuururldllurr"
      }
    },
    "sasquatch-5-10": {
      "rowsHash": "8d4caf81c1744e6860b3a15dc569bcf854fd5ae70ae52820ee56039fa1ee2fc2",
      "moves": {
        "value": 174,
        "path": "luuurrrrdulldrullldrlddruluuururrrrrdrdddlddldlllluluuruurrdlurrrdllulllddddrdrrrruruuruuulullllldldddrduluurdlddrrrruululrdrddlllluuuururrrrrdrdddlddldlllluluuururrdlrrrulll",
        "pushes": 23
      },
      "pushes": {
        "value": 23,
        "path": "luuurrrrdulldrullldrlddruluuururrrrrdrdddlddldlllluluuruurrdlurrrdlullllddddrdrrrruruuruuulullllldldddrdrrruulrddllluluurdlddrrrruululrdrddlllluuuururrrrrdrdddlddldlllluluuururrdlrrrulll"
      }
    },
    "microban-84": {
      "rowsHash": "1fe50ce3e39e56024cb0ceff655dc4ee8669432691e62af7a59a3d298282a56a",
      "moves": {
        "value": 201,
        "path": "drluurdrdduuruluullllddddddrrrrrrdrrulllluuullurdrdddllldluuuuuluurrrrrddddduuuuulllllddrddddrrrrrrdrrullllllrruuulldrurdduuuuulllllddrulurrrlldddddddrruldluuuuuulurrlddddddrrrrrrdrrullllllldluuuuuulur",
        "pushes": 68
      },
      "pushes": {
        "value": 68,
        "path": "urlddrluurdrrulddduuuuullllddddddrrrruuullurdrdddlllluuuuuurrrrdddduuuullllddddddrrrrrrdrrulllllldlluuuuuuurrrrddddduulldrurduuuulllldddddddrrulrrrrllldlluuuudddrrrrrrlllllluuuuddddrrrrrrdrrulllllldlluuuuuluurrrrrddddduuuuulllllddrulurrldddddddrrurrlldlluuuuuuurrlldddddddrruldluuuddrrrrrrlllllluuudddrrrrrrdrrulllllldlluuuuuuddddddrruldluuuuuluurrllddrulur"
      }
    },
    "microban-80": {
      "rowsHash": "ad9bf96e61da2678b46dea8e7d9fa6406839e9a8777839f10db34c4105de639d",
      "moves": {
        "value": 131,
        "path": "lddrudrruluuuudllluuluurdrrdrrrurddulllddddddllurdruuuuudllluuluurdrrdrrrdrudlddruluulldddddllurdruuuudllluuluurdrrdrrrllddllluulur",
        "pushes": 38
      },
      "pushes": {
        "value": 38,
        "path": "lddrudrruluuullluuddrrrudllluuluurdrrdrrrurddulllddddddlluurlddrruuuullluuddrrrudllluuluurdrrdrrrllddddlldruruuuurrdrulllddddrddluuuuudllluuluurdrrdrrrdddruluullddllluulur"
      }
    },
    "microban-76": {
      "rowsHash": "85ea91325f42bba1c66b6f3574f9c6d295cf20c337060eea58e7e743c62e6b5d",
      "moves": {
        "value": 181,
        "path": "rddrddrrrruuldrdllldluuluuuuurrddddlddrrruuuuurrdlulddddrdllldluuluuuulururrdddddlddrrruuruluurrdlulddddrdllldluuluuuluururrdddddldluluuuurrurddduulllddrulurrurddullddlddruuulurrurd",
        "pushes": 56
      },
      "pushes": {
        "value": 56,
        "path": "rddrddrrrruulduuuurrdluldddrudddllldluudrrrruuuluurrdlddddlllluluuuuurrddddlddrrrruulduuruuldrddddllldluuluuuuddddrdrrruuruuldrdddlllluluuuulururrdddddlddrrruruuldrddlllluluuuddrddrrrruuldrdllldluuluuuluururrdddddldluluuuurrurddduulllddrudlddruluuurdlddruluurrllddrulururrdduulldrurd"
      }
    },
    "microban-85": {
      "rowsHash": "5bf74b82d1d2639b4183af872cd4db962e67eb740f3d43a5bf68fa116d3a30ce",
      "moves": {
        "value": 155,
        "path": "luuuurrurrdrullldllurdrrurrdllllulddddldrrrlluuuurrrurrrrdllllllulddddldrrlddrrrruuuullddrlllddrrrruuurulddlldulluuuuurrrrrdrruuldrdllllllulddddldrrrllddrr",
        "pushes": 51
      },
      "pushes": {
        "value": 51,
        "path": "luuuurrurrdrullldrlllurdrrurrdllllurrlllddduurrrrrurrdllllurllldldddldrrrlluuuuurrrdllulddddldrrlddrrrruuuullddlluuuuurrrrrdlllllddddrrrllluuuurrrrrrruuldldlllllddddddrrrruuudlllluuuuurrrrrrrdllllulldlddddrrrrurulddlllluuuuurrrdllulddddldrrrdullddrr"
      }
    },
    "microban-78": {
      "rowsHash": "bfce62711c36b08cabb7ea5db4c057859bd2da2e7229d5dd801a95dcb184174c",
      "moves": {
        "value": 135,
        "path": "uurruurrddduuullddrlllddrrrrrrlluulluurrdddullllddrrrrrluullururdddullllddrrrdrrullruuuulllldrrrurddduullllldrddrdrrurdlllurlluurrrurdd",
        "pushes": 35
      },
      "pushes": {
        "value": 33,
        "path": "uurruurrddduuullddllddrrrruuuullddrlllddrrrrrllllluurruurrddllllddrrrrrrlllllluurrrrdullllddrrrruuuullldrdrrddlllluurrrluurrddllllddrrrrrllllluurrrrdulllllurrdlddrrrdrrullruuuulldldrrluurrdddullururdldlllddrdrrurdllluluuurrrrdllllddrrlluurrrrd"
      }
    },
    "sasquatch-4-21": {
      "rowsHash": "3c8ee7d9f6ca22899a5b2e83720b1904a35de25b99d8e5721fb63fdc5d4a4899",
      "moves": {
        "value": 151,
        "path": "uluulldldlddrrurrdrurdddrrururuulldlluldllldllurrrrdddlluuddrruuuurrdlrrrurrdlllluuurrddrdllrrddluruluuullddllddrulurdllldllurrrlluururrdullddldrdddrru",
        "pushes": 40
      },
      "pushes": null
    },
    "sasquatch-1-21": {
      "rowsHash": "17fdeda41cc122ada98c38023136038c7138c4aa7c3e267d49bb0f849febb261",
      "moves": {
        "value": 104,
        "path": "luulllddlldlluurrrlllllulldrrrrrrddlulurllllddrrrllulurrrdrrrrrrdrrullllllrrrrruuldrdllllrrruulldurrddll",
        "pushes": 38
      },
      "pushes": null
    },
    "microban-92": {
      "rowsHash": "1cd74cc2ac9e6ca17f197dc42466c3683fa9a9c80625ab12f0b4b688ee9454af",
      "moves": {
        "value": 126,
        "path": "uuullllllrrddllulldllurrruuluurdddrrrrrrruurrddlruullddllllddllulldllurrrurrrrrrrddrruulrddlluuddrddluurruullllllddllulurrrrrr",
        "pushes": 48
      },
      "pushes": {
        "value": 48,
        "path": "uuullllllrrddllulurrrrrrruurrddlruullddlllllldllrurrrrrrrdulllllldlldllurrrurrrrrrrdduullllddllulurrrrrllllluluurdddrrrrrrllllldlldllurrrurrrddlludrruurrrruurrddlrddlluuddrddlururuullllllddllulurddrruurrrrrrddldlurruullllllddlluurrrrr"
      }
    },
    "sasquatch-7-19": {
      "rowsHash": "6a19cc0c7f4cccb0e227013238c9e36cefdff7cf660b5f1d489c600552de2010",
      "moves": {
        "value": 71,
        "path": "ulullddduuurrdlrrddllulldrlldlldlddrudrruluddlluururduluuurrllddrrurrdl",
        "pushes": 18
      },
      "pushes": null
    },
    "sasquatch-2-1": {
      "rowsHash": "f8cef6a29158592bdb83a85d5a2f97844480aae755f015054b369a930c5b135e",
      "moves": {
        "value": 168,
        "path": "lllldrullldrrllddrrrruurullldrllluruuuuulldrurdddddldrlddrrrruuruuulluulldddddrrurldlllddrrrruuruldllluuuuuulldrurdrrddrrduuullllddddldrrrlllddrrrruullluuuuuulldrurdddd",
        "pushes": 45
      },
      "pushes": null
    },
    "sasquatch-7-10": {
      "rowsHash": "28ad4248358c2da6053ba7dd34e086fc6051bea82af54bf332572306693f85db",
      "moves": {
        "value": 96,
        "path": "urlddrurrldruurrdrruuulllldddrrddluddlluurulrurrdldlluruuurrrrdddlruuulllldldrddllluurrllddrrruu",
        "pushes": 25
      },
      "pushes": {
        "value": 19,
        "path": "urlddrurrrdddlluuddrruuuurdlllrrrrruuullllddrdddrulurddldlluurlddrruruuldlluruuldururrrrdddlruuullllddddllluurrllddrrruu"
      }
    },
    "sasquatch-4-3": {
      "rowsHash": "d90866c1d2b667f3084f0b4451972aacca1565998f5b42c51f5ccaa4ee3c51b3",
      "moves": {
        "value": 144,
        "path": "rdrdlurrrdlullulldddldrrrrdruuuruuulldlddlruururrdddlddlllluurrrluurdrlldllddrrrruurullullldddldrrrrdruuuruldddlllluurrrlllddrrrruulllluurrrurrd",
        "pushes": 35
      },
      "pushes": {
        "value": 35,
        "path": "lddduuurrdrdluulldddldrrrrllluuuurrdrrrdlullullddddrrrdruudlllluuuurrdrrruulldlllddddrrrruuruuulldlddlruururrdddlddlllluurrrluurdrlldllddrrrruurullrdddlllluurrrlllddrrrruuluulllddrrrrruldlllluurrrurrdulldllldddldrrrrdruuu"
      }
    },
    "sasquatch-6-5": {
      "rowsHash": "7e2cf20df08a3142be7070dc440b796cd46b2267b3ed901ffdffb1532a4c9447",
      "moves": {
        "value": 144,
        "path": "luulldldddrrdruuulluldrrrrrddrruruuulluldddrrddlludrrurullluurrdduurrdldllllllluurrdullddrrddlludllurdrrruuuulldldruurrddddlluuddllurdrrruulrrrr",
        "pushes": 36
      },
      "pushes": null
    },
    "sasquatch-5-4": {
      "rowsHash": "23a3725c192fdb86727ccca2e5ab270ed5dc1da76e914794ea6efb43878a3e07",
      "moves": {
        "value": 138,
        "path": "uuuuuldrddddllululludrruurrurdddlurddrdlldlluluruuurrurdddduuullldldllurrdrddlurddrruruuuulllddlddrrlluurdldruuullldrrulluurddldrurdduurdd",
        "pushes": 42
      },
      "pushes": null
    },
    "sasquatch-4-2": {
      "rowsHash": "0975b8a95ce2f1ee8f37e918f3db06242b203dec68da44617cc41d702204aaeb",
      "moves": {
        "value": 102,
        "path": "luurrrllluurdurrrurrdldddllulldlurrrdrrulllluurrrurddulllldddlddruuurrrruulllldulldrdrrrllluurdldrddlu",
        "pushes": 32
      },
      "pushes": {
        "value": 32,
        "path": "luurrrdrruuulllldurrrrdddllullduullurrdddluruurlddrrdrrulllluurrrurddullllddrrrrlllldlddruuurrrruulllldulldrdrrrllluurdldrddlu"
      }
    },
    "sasquatch-7-17": {
      "rowsHash": "3c83a96143b5d4a2d041f069cab4cb021967713e1553c08f9081f4d4c5def28a",
      "moves": {
        "value": 136,
        "path": "ldlldlrurrrddlddrudrrulldluddlddllurdruluuluuruurrrdddlddlruruuuulllddlddrurlddrruruuuulllddllluurdldrrdrddrddluurrururrdlluuuulllddllur",
        "pushes": 30
      },
      "pushes": null
    },
    "sasquatch-5-7": {
      "rowsHash": "4d3d4f406784b091f2c9b02eacd036c085c8ea4d5f287210ac84c4dafffa0a90",
      "moves": {
        "value": 100,
        "path": "ullllllllddrurulrrrdlurrrdlurrrdlrddluurullllldllurrrrdlddruululldrrddluulldllurrruuuruulddddldllurr",
        "pushes": 35
      },
      "pushes": null
    },
    "sasquatch-1-11": {
      "rowsHash": "c1cf6a759dc6c19986859763a840ca9a6a4f49c7c6edfb30f07b76497d8c9561",
      "moves": {
        "value": 101,
        "path": "rddddrruulrddlllluuurrdduulldruuuldllddrrudddrruulrddlluulluurrurdrddllurdlddrrrdrurruulllllulduruuld",
        "pushes": 30
      },
      "pushes": null
    },
    "sasquatch-4-13": {
      "rowsHash": "ed2099be22f3f035087db33c648e8188278fc4a33b23fa7d1bd3d82760db9703",
      "moves": {
        "value": 149,
        "path": "lluurdldrluuuuurrdluldurrrrrddlurulrdddddrruldluuuluulldllddrddrrurldlllddruluruuluuulldrurdrrurrruuldrdlddrudddllddrulurdllluulldrurdluuurrurluldrdl",
        "pushes": 40,
        "basis": "public-record",
        "source": "https://www.sokobanonline.com/play/web-archive/david-w-skinner/sasquatch-iv/2935_sasquatch-iv-13"
      },
      "pushes": null
    },
    "sasquatch-4-11": {
      "rowsHash": "b59e360ce6e8431235272d7bc510a07cb42b2f954879d28c752721d16e1873bc",
      "moves": {
        "value": 255,
        "path": "dlddddrddluuuuuddddlldllurrrlluuruulddduuuruulldlddldrrluuururrrrrdlddddrddlulldlluuddrrurruuuuululddlddlddrrrllluurduuuruulldlddldrrluuururrrdrrullllrrrdddddrddluuuuuurulllddlddlddrrrllluurduruuurrddddrddluuuuuddddlldllurrrlluuuurururrdlddddrddluuuuuurul",
        "pushes": 71
      },
      "pushes": null
    },
    "microban-88": {
      "rowsHash": "cce945ae853665720eef27c5fcf97ebea4956a2bc88841d6c5ca9100e76f86c4",
      "moves": {
        "value": 195,
        "path": "rrruuldrdlldllurrruuruulddduuuruulduurrrdddddddldlulldllurrrruuuuuldddduuuuuurrrdddddddldlulldllurrrruuuluuuurrrdddddddldluuluuuurulurrurdddddduuuuullddlddruuulurrurdddduuullddddlddruuuuulurrurdd",
        "pushes": 67
      },
      "pushes": {
        "value": 63,
        "path": "rrruuldrdllruuruuldrdddlldllurrruruuldduuuruuurrdddddddldluluuuuruuldrdddlddlrrudlldllurrruuuruulddddruluuuuurrrdddddddldluluurudlddlruuuruddlddruuddlldllurrruuuuuuurrrdddddddldluluuuuruulurrurddulldddlddruuluuurrrddduuulldlddruluurrrddddduuuuulllddrulurrurddduulldddddlddruuuuuluurrrddduuulllddrulurrurdd"
      }
    },
    "sasquatch-5-8": {
      "rowsHash": "4f852a915a7964149f7d5ed9e90d5303462bd529af0b0a560fc9a9c25311055c",
      "moves": {
        "value": 128,
        "path": "ullllllldurrrdddluururrdlurrrdllulldllulldrurrrrrdlulldddrrululurrldddlurrurrruuldrdllrrddlurulrrrdddldllllllluluuulurruuruulddd",
        "pushes": 33
      },
      "pushes": null
    },
    "sasquatch-1-9": {
      "rowsHash": "dc11f1637a15192a010e073e47a3af85538f53b6ec9c02b082ab0ae687fde546",
      "moves": {
        "value": 150,
        "path": "uullllldrrurrrdddlddlldluuuuulurrrrdrddllldluudrrrruululldrrulllldrrrllddrrrdldldluuuudrrrruruullldllurrdllddrrdldluuuuddrrrruruuldllulldddrrrrurulull",
        "pushes": 48
      },
      "pushes": null
    },
    "sasquatch-4-19": {
      "rowsHash": "5566348dca35292bd8e7db36cee5fe658a3b8a154a3c59bffb1164c5d42d1894",
      "moves": {
        "value": 120,
        "path": "rruuuruulllddrddrdllluluurddlllddrruudrrrurrrddlldluruudlllulllddrrdrullluurrdruuuldrddrrurduluuluurrrddldlddlluululuurr",
        "pushes": 32
      },
      "pushes": null
    },
    "sasquatch-7-2": {
      "rowsHash": "25e0da5ee61c0d9b7d7b6bc060783699fe8f8adbb81d4017ebb5fcb3531ed9e6",
      "moves": {
        "value": 94,
        "path": "ullddlluuruurrdullddrddrddlluruuldrrruullruuurrdlulddullddrddrruuluullddlllddrrrllluurrduruuld",
        "pushes": 21
      },
      "pushes": null
    },
    "sasquatch-1-7": {
      "rowsHash": "96633d8ec2c9cea0dbaaf30edd2f681b8c498dfb161943e8c7b55ce758f5f8ee",
      "moves": {
        "value": 199,
        "path": "ullddduulldrurrrrrrrrrrrdrruudrrulldllllllllrrrruururrrddrdlllurdllluururrrddrdlllurruullldlddllddlldllldlluruulururrddlurdrurrrrlddlldllldlluruulurrrrrrrddlldllldluuulurrrrrrllluurdldrrllllurrurdldr",
        "pushes": 70
      },
      "pushes": null
    },
    "sasquatch-1-13": {
      "rowsHash": "8a40716969e7fc0f870b4ddd62a7d11c226847e416738dcfeb268e4b8ed76434",
      "moves": {
        "value": 161,
        "path": "uluurrrrdrddddldlrddlullllluuruuddllurdrdldrrrrrruuruuuululllldlldrddddldrrrrrdruuddrdrddluudluuullluurdldrrlllluuuuurrdrrullluldddddldrrrrldddrrrlurrrddluruldlu",
        "pushes": 54
      },
      "pushes": null
    },
    "sasquatch-4-20": {
      "rowsHash": "bd80bcddb11ecb808b461e372ad3977022bb9dbbaf773b38ed3b476bfbf6d291",
      "moves": {
        "value": 114,
        "path": "uuluuddrddrruldludlurruuuluurddduuullldrrurddulldulldddldludlluruululuurdrdulldrddrddrruldludluuuuluurddduurrdluld",
        "pushes": 36
      },
      "pushes": null
    },
    "sasquatch-7-6": {
      "rowsHash": "8f093833587f7429a8c05b316b5f022c554e5c0beb5ceab492281d6a5e01ab82",
      "moves": {
        "value": 146,
        "path": "llluururrdruuldlldrrurrruluullddrdldlluurrllluurdldrddrruuullddruruurrddldlrurrdlullddlllddrrrrruuuullddrluurrdldllllddrrrrruuddllllulurrrruurrdld",
        "pushes": 36
      },
      "pushes": null
    },
    "sasquatch-4-29": {
      "rowsHash": "d89e6a2ac8b4da7676ee2717592aaff63dfc942ad926a5d7fe52bb056c54d067",
      "moves": {
        "value": 267,
        "path": "drruurrruuurldddrruuldlddulllddllddrrrrrdrrruruuuuuuuullulddurrrddddddddldlllullllluurrrruruurruuddllddllurddllllddrrrrrdrrruruuuuuuuulldddddlllrrruulldurrddlddruulluurruulduruulddurrrddddddddldlllullllluurrrrrurruuuullddduuurrddddddlullllllddrrrrrdrrruruuuuuuuulluld",
        "pushes": 33
      },
      "pushes": null
    },
    "sasquatch-7-14": {
      "rowsHash": "317e608c54af06940b24a6c0cf87ca6fb0280cf018aca7c053130b2edbe4989e",
      "moves": {
        "value": 245,
        "path": "lluulrddrruullddlldddrruuddlluuuullluurrrdddrrdddlluuluruuulllddrrlluurrrddlddrddrruuuuulrrrddrruullllddrrlldddlluuluurdrrdddlluuddrruuullullluurrrdddrruulrddllullluurrrdrrdddddlluuludrddrruuullrruulldduldururrrrddlllluurrrrrrddlllllruullulllddr",
        "pushes": 50
      },
      "pushes": null
    },
    "microban-83": {
      "rowsHash": "68a39d26680760b06e3656b394617c0b2a22ea095799a942be8c6767586c1417",
      "moves": {
        "value": 164,
        "path": "urruuuululldddddrrruulurdddllluuurrlluurrdrddddldldluurrrrdllulluuurrurddddrdluuuuululdulldrdrrurddduuululdlddddrrrlllddruluuuurrdrdddluruuluurddddldruuuullldddrldr",
        "pushes": 47
      },
      "pushes": {
        "value": 47,
        "path": "urruuuululldddddrrruulurdddllluuurrdrdddlldluuudrrruululluurrdrdduulullddrrdrddrdlullluuurrurdllldddrrrdlulluuurrrdduuululdulldrdrrdrdduuluurdllldddrrrrdlullluuurrrdduuululdlddddrrrlllddruluuuururrdddddluruuuulldrurddddldruuuullldddrldr"
      }
    },
    "sasquatch-4-4": {
      "rowsHash": "e1590b5210776225428e63dec2ab09d9905657bec08813f126ce025bfa5d7355",
      "moves": {
        "value": 102,
        "path": "ldlurdddlulrruuldurruruuldduuulllddrrudlddruudddddllurdruuuudldrddllurdruuddllllurrruuurrruuldrdlrddlu",
        "pushes": 29
      },
      "pushes": null
    },
    "sasquatch-5-12": {
      "rowsHash": "956c1c1b97e7cecaeba71c73099354686d1cc1dc31d76468b13bf05dee8c338a",
      "moves": {
        "value": 100,
        "path": "lldrdrdldduurrddlurululuurdddrddluluurdldldrlddruuuurrdrdddlulrruuldlruulldruuuulldrurdddrduluuurrdl",
        "pushes": 33
      },
      "pushes": null
    },
    "sasquatch-6-21": {
      "rowsHash": "8de01195bc5b8ae14586bb5883bc4f5601a6b7679e07f9c66ff4fe96f6ca6afb",
      "moves": {
        "value": 78,
        "path": "uuulddrdrdrrululldrdldlddruruuldullulldrdrrulrruuullddrddlurrrdluluurrdullddru",
        "pushes": 22
      },
      "pushes": null
    },
    "sasquatch-3-5": {
      "rowsHash": "73f58d535a75980b01a3115c67c00c1cbc1dbd9339c08a55938da59823fdc10a",
      "moves": {
        "value": 278,
        "path": "ldlruulllldlllrrrurrdllllurrdrrurrdlllllurrdrrrrrddldldlluruurullldrulullddrrulrrrrrrddldldlluruurullldrurrrrddldldllullllllluluuuururrrrrrrrddrdldlluurlddrrulrrrrddldldllullllllluluuuururrrrrrrrddldrruluulllllllldlddddrdrrrrrrrdrruluuruluuulllllllldlddddrdrrrrrrrdruuuddrruruul",
        "pushes": 57
      },
      "pushes": null
    },
    "sasquatch-5-3": {
      "rowsHash": "9782c4ba65e9c45d327e0887724c408e39e6c4922e8c35f55d8f97e74280793c",
      "moves": {
        "value": 140,
        "path": "lluuddrruluulllrrrdddluurulluuurrdddllulllddrulurrldddrdrrurrdluluurdulllullddruddrdrdruuurulllrrdddllululuurdrrulrdrdddrruldluurullrruuulld",
        "pushes": 41
      },
      "pushes": {
        "value": 39,
        "path": "lluuddrruldluruulllrrrddlurullulllddrulurdddrdrdruruuulllrrrdddluurulluuurrdddldddllululuurrllddrulurdddrdrruuurdulllrudrdddllululuurdrrulrdrdddrruldluurullrruuulld"
      }
    },
    "sasquatch-1-22": {
      "rowsHash": "3dea4ea1bd395ed6b6a19fb3cbc01acf7e94f236bab0821298036c7d7b31c990",
      "moves": {
        "value": 163,
        "path": "rrddrruldlluurdldrrdrrrddluulldrurrddlulllllululldrdrrrrrllllldddrrrrrrddrdrruluurrruuuuuulllllldlurdddrrdrrululduldlludlllluurdlddddrrrrrrddrdrruluurrruuuuuulllld",
        "pushes": 36
      },
      "pushes": null
    },
    "sasquatch-4-37": {
      "rowsHash": "13791eae328a7d9473e946b906416562825120cbe6dfd7ce2a59ada3e483249d",
      "moves": {
        "value": 81,
        "path": "rdrdrruluulluruuldllddlulldrddrrdlddrurrdruluuddllululldruuururuuldrrrdrdrruldddl",
        "pushes": 28
      },
      "pushes": null
    },
    "microban-36": {
      "rowsHash": "2511106ef6fc84f8eca3b0422645d9907e3e8e7c3a234d6e109d8f6c0a565041",
      "moves": {
        "value": 156,
        "path": "dllllllllllluurdldrrrrulldlluurdldrrurrdrrulllldrrurrdrrulllldrrlllllluurdldrrrrulldlluurdldrrurrrrrrrrdrrulllllllllldlluurdrrrdlurrrdllurrrrdlllurrrrrdllll",
        "pushes": 59
      },
      "pushes": null
    },
    "sasquatch-6-6": {
      "rowsHash": "f617e065cd50f05f94e3f38c0b721af1b9d2a434638e652b3f255193626626c7",
      "moves": {
        "value": 153,
        "path": "ulluullddrrllldllulldrrurrruullldurrrddllluurrrrrddllrrrddlludrruuluullddldruuurrddllrrrddlluluuullldddrrruuurrddlrrdrruldldllulurdlllluuurrrdullldddllur",
        "pushes": 34
      },
      "pushes": {
        "value": 34,
        "path": "ulluullddldllrrurrrllldllurllldrrurrruullldurrrddllluurrrrrddllrrrddlludrruuluullddldruuurrddlrrddlludrruuluullllldddrluuurrrrrddrddlluludrdrruuluullllldddrrlluuurrrrrddllrruullllldddrrrurrrdrruldldllulurdlllluuurrrdullldddllur"
      }
    },
    "sasquatch-3-7": {
      "rowsHash": "c7b3feb23165a381155b07a869254985b3340b8a70ead0dc111b1af79c1f5dde",
      "moves": {
        "value": 123,
        "path": "uuurrudlddrurrddrdduuulullluurrdldddrruullddrddludddruuudrrurrdllllrrrddlurdrruruuuuuuulullllullddrddrdrrdduullulldllurulur",
        "pushes": 30
      },
      "pushes": null
    },
    "sasquatch-4-26": {
      "rowsHash": "fc17460a0c95519ba427298156565a1999071586b64469ade6b742b895ed048b",
      "moves": {
        "value": 235,
        "path": "rdrddddllurdruluruuldurrrrurrdllllldldrddllurdrudlllllluurrruuurrdrrrdddddrddluuuuuululldrurrrurrdllllldlddrudlldlllluurrruuurrdddrddlllllrrrrruuldrdllllrruruuurdurrdllulddduurrrddlldllrruuldldlddrrruullrrurruulluldddrdluuurddrrulluldd",
        "pushes": 85
      },
      "pushes": null
    },
    "sasquatch-4-9": {
      "rowsHash": "72999e7aeea615b9a37ee8b2a4e0259d2f7da81afc303f14a750617cfc567178",
      "moves": {
        "value": 222,
        "path": "rrddlddrddluuuurdlddrrrdruuluuruulddddruluurrrurddlddrddluuuurddlddrruldluuuruullluldddrulurrrurddddulurulllulddurrrdddddrruldluuuurullluldrddddllldluuurdldrrrdruuuddllluuuuulldrurddddldrrrdruudllluuluruulldrurddddldrrrdru",
        "pushes": 88
      },
      "pushes": null
    },
    "sasquatch-1-4": {
      "rowsHash": "3d38334c828227f73f5f7303f8e640d44c1aed414a3908284c90a78b828a9e46",
      "moves": {
        "value": 277,
        "path": "dddludlulllluurrdullddrruuldullldrrddluruurrdddlddrdllllurrruuruulddddrdllullddrururuuurrrdrrullllulddddrdllldllururdrruuuurrrrruuldrdllllulddddrdllluldllurrdrrruuuurrrruuldrdlllulddddrdllllullddrurrrruuuulldrurdddrdllllldlurrrrruuuuuuldulldrrurdddddrdllllrrruuullururddddrdlll",
        "pushes": 97
      },
      "pushes": null
    },
    "sasquatch-4-12": {
      "rowsHash": "e48d5ac5527582538758b7f76495c405976eceadb30bbc8d228e1060ad69c82e",
      "moves": {
        "value": 314,
        "path": "uuuluuullullddldlddrluururrdlddddduuuuuuuurrdrrdddrddlurdddlulrruuldldlldluuulluururuurrdrrddddrddllllrrrruulduuuuullullddrdrdrlululuurrdrrdddllululldrllddrruuuuddddddrdddlluruuuuuuudddddrrrurrdlllldlddruluuuuddrrrurruulddrdllllrruruullululldlddrrdduulluururrdlddlluururdrrdrrdddlllludrrruruuuuulluullldrduurrdluld",
        "pushes": 68
      },
      "pushes": null
    },
    "sasquatch-1-16": {
      "rowsHash": "51b416319ec1923ff1caea86fde5fcb996d2c02b7e43185de4ecc6678b49002c",
      "moves": null,
      "pushes": null
    },
    "sasquatch-3-1": {
      "rowsHash": "ddbe76b58746aab04491a90c3efd4f2f0e0c9ca9700961484070f7bf03fdbaec",
      "moves": {
        "value": 226,
        "path": "lurdrddddddlldlluruuuurudldddddrdrruuuuruuluululldrddldddddrdrruuuuruuluurullrdddddddlldlluruuuuruururdlllurrdrddrddlddlldluuuruuudddlddrrruuruuluululldrddddlddrrruuruuluurullrdddrddlddllddrruldluluuuruuuururdlllurdddlddddldrr",
        "pushes": 46
      },
      "pushes": null
    },
    "sasquatch-1-3": {
      "rowsHash": "f438c7a540a17b3be8c293c34a489e8d5cebf5a5c2c16d258336835a067638f2",
      "moves": null,
      "pushes": null
    },
    "sasquatch-4-23": {
      "rowsHash": "b331af5aeeb4642d72d4e6003594e3d6a71e047990be32e168155d36978c9dc6",
      "moves": {
        "value": 270,
        "path": "llluldrdllrurrruuluurdddrdllluldrrruuuuuuldllldldldllurururrlldlddrurururrrurdddddrdlllullldlddrurrudllluuuluururrrrrurdddddrdlllrruuuuulllllldlddrdrrrdulllddrulurrlluurudllururrrrrurdddddrdlllrruuuuullllllddrulurrrrrurdddddrdllruuullururddddrdluuuuulllldllurrrrrurddddd",
        "pushes": 104
      },
      "pushes": null
    },
    "sasquatch-4-6": {
      "rowsHash": "b09edadf6bc23a6615152e58779d36eead3cb931c3ee8b35cf93da7d2f8ed8bc",
      "moves": {
        "value": 453,
        "path": "rdrrrruuuurrdllrrrrrddlurullldrulullddrlddruluuurrdluldddruddllllllluuuuullldddddrdruuuuuddddlluuuuurrurddddrrddrrrruuuurrdluldddrdlllllllluuuuulldddddrdruuuuudddrdllluuuuurrurddddrrddrrrruuurrrdllulddrdlllllllluuuuulldddddrdruuuuuddddlluuuuurrurdddldddrrrrrrruuurrrrrdllllulddrdlllllllluuuuulldddddrdruuuuuddddlluuuuurrdddddrrrrrrruuuulldrurdddrdlllllllluuuuulldddddrdrurrrrrrruuulldrurddrdlllllllluuruululldddddrdruruuluuddrddluuudrddrrulldluurdrrullu",
        "pushes": 142
      },
      "pushes": null
    },
    "sasquatch-4-27": {
      "rowsHash": "ab02673c5cf9e18f6d5b1f1645ace91889dcfccbce157eee358f256cd3022252",
      "moves": {
        "value": 492,
        "path": "ullllldurrrrrddlurrdrdddddrdllllulduruuururuulullldrrdrddllululluurrurdrrdrdrdddddrdllllddllurdruuulduruuluuluurrdrdrldldlllullluurruurrdddrduluuullddrluurrurdrrdrdrdddddrdllllddllurdruuulduruuluuluurrdrdrluluurdrdrdddddrdllllddllurdruuuldrddllururrrruuuuuululllldlluurrurdldrrdrdrluluurdrdrdddddrdllllulddldruurrrruuuuuululldrdrldldduuruuullldllllddrrrdrrllullluuurdrrrdrdrdululuuulldldrrlllddrrrdrruuluudlluurrurdldrrurdrdrdddddrdllllrrruuuuuululldrdrluurdrdddddrdlllrruuuuuulldrurdddddrdll",
        "pushes": 167
      },
      "pushes": null
    }
  },
  "levels": [
    {
      "id": "microban-44",
      "sourceNumber": 44,
      "rows": [
        "#####",
        "#@$.#",
        "#####"
      ],
      "solution": "r",
      "minPushes": 1,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 1,
        "boxSwitches": 0,
        "goalWithdrawals": 0,
        "boxes": 1
      },
      "difficultyScore": 6,
      "difficulty": "beginner"
    },
    {
      "id": "microban-2",
      "sourceNumber": 2,
      "rows": [
        "######",
        "#    #",
        "# #@ #",
        "# $* #",
        "# .* #",
        "#    #",
        "######"
      ],
      "solution": "rddlruulduullddr",
      "minPushes": 3,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 3,
        "boxSwitches": 2,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 24,
      "difficulty": "beginner"
    },
    {
      "id": "microban-24",
      "sourceNumber": 24,
      "rows": [
        "# #####",
        "  #   #",
        "###$$@#",
        "#   ###",
        "#     #",
        "# . . #",
        "#######"
      ],
      "solution": "ullddlddrruluuurrdluldddullddrruuld",
      "minPushes": 9,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 9,
        "boxSwitches": 2,
        "goalWithdrawals": 0,
        "boxes": 2
      },
      "difficultyScore": 25,
      "difficulty": "beginner"
    },
    {
      "id": "microban-30",
      "sourceNumber": 30,
      "rows": [
        "####",
        "#  ###",
        "# $$ #",
        "#... #",
        "# @$ #",
        "#   ##",
        "#####"
      ],
      "solution": "uluurdlddrdruruulluld",
      "minPushes": 5,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 5,
        "boxSwitches": 2,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 26,
      "difficulty": "beginner"
    },
    {
      "id": "microban-25",
      "sourceNumber": 25,
      "rows": [
        " ####",
        " #  ###",
        " # $$ #",
        "##... #",
        "#  @$ #",
        "#   ###",
        "#####"
      ],
      "solution": "urrdlulluurdldrlddrurruulluld",
      "minPushes": 7,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 7,
        "boxSwitches": 3,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 31,
      "difficulty": "beginner"
    },
    {
      "id": "microban-3",
      "sourceNumber": 3,
      "rows": [
        "  ####",
        "###  ####",
        "#     $ #",
        "# #  #$ #",
        "# . .#@ #",
        "#########"
      ],
      "solution": "ruullluldrrrrddlurulllddllluurrdrdluuurdd",
      "minPushes": 13,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 13,
        "boxSwitches": 3,
        "goalWithdrawals": 0,
        "boxes": 2
      },
      "difficultyScore": 32,
      "difficulty": "beginner"
    },
    {
      "id": "microban-40",
      "sourceNumber": 40,
      "rows": [
        " #####",
        " #   #",
        "##   ##",
        "# $$$ #",
        "# .+. #",
        "#######"
      ],
      "solution": "udlluruurrdlulddurdurd",
      "minPushes": 7,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 7,
        "boxSwitches": 4,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 34,
      "difficulty": "beginner"
    },
    {
      "id": "microban-9",
      "sourceNumber": 9,
      "rows": [
        "#####",
        "#.  ##",
        "#@$$ #",
        "##   #",
        " ##  #",
        "  ##.#",
        "   ###"
      ],
      "solution": "urrdulldrdrluurdrddluruldlurul",
      "minPushes": 10,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 10,
        "boxSwitches": 5,
        "goalWithdrawals": 0,
        "boxes": 2
      },
      "difficultyScore": 35,
      "difficulty": "beginner"
    },
    {
      "id": "microban-56",
      "sourceNumber": 56,
      "rows": [
        "#####",
        "#   ###",
        "#  $  #",
        "##* . #",
        " #   @#",
        " ######"
      ],
      "solution": "uullulldrurdrddlluruuld",
      "minPushes": 6,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 6,
        "boxSwitches": 3,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 37,
      "difficulty": "beginner"
    },
    {
      "id": "microban-45",
      "sourceNumber": 45,
      "rows": [
        "######",
        "#... #",
        "#  $ #",
        "# #$##",
        "#  $ #",
        "#  @ #",
        "######"
      ],
      "solution": "luluuurrrdlulldddrdrruluurulddddlluuurldddrruuuddldluuu",
      "minPushes": 11,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 11,
        "boxSwitches": 4,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 38,
      "difficulty": "beginner"
    },
    {
      "id": "microban-1",
      "sourceNumber": 1,
      "rows": [
        "####",
        "# .#",
        "#  ###",
        "#*@  #",
        "#  $ #",
        "#  ###",
        "####"
      ],
      "solution": "dlurrrdlullddruluruuldrddrruldluu",
      "minPushes": 8,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 8,
        "boxSwitches": 3,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 39,
      "difficulty": "beginner"
    },
    {
      "id": "microban-12",
      "sourceNumber": 12,
      "rows": [
        "#####",
        "#   ##",
        "# $  #",
        "## $ ####",
        " ###@.  #",
        "  #  .# #",
        "  #     #",
        "  #######"
      ],
      "solution": "uululldrdrluurdrddrddlluruuulldrurddrrrddlludllur",
      "minPushes": 11,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 11,
        "boxSwitches": 6,
        "goalWithdrawals": 0,
        "boxes": 2
      },
      "difficultyScore": 39,
      "difficulty": "beginner"
    },
    {
      "id": "microban-21",
      "sourceNumber": 21,
      "rows": [
        "####",
        "#  ####",
        "# . . #",
        "# $$#@#",
        "##    #",
        " ######"
      ],
      "solution": "dllludrulluurdrddlu",
      "minPushes": 5,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 5,
        "boxSwitches": 4,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 39,
      "difficulty": "beginner"
    },
    {
      "id": "microban-51",
      "sourceNumber": 51,
      "rows": [
        "####",
        "#  ###",
        "#    ###",
        "#  $*@ #",
        "### .# #",
        "  #    #",
        "  ######"
      ],
      "solution": "rddlluluruldlluurdldrrurdlddrrruul",
      "minPushes": 8,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 8,
        "boxSwitches": 3,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 39,
      "difficulty": "beginner"
    },
    {
      "id": "microban-33",
      "sourceNumber": 33,
      "rows": [
        "#######",
        "#. #  #",
        "#  $  #",
        "#. $#@#",
        "#  $  #",
        "#. #  #",
        "#######"
      ],
      "solution": "ullldlurrrrddllrruulldllddruluurrrrddlllruullddrrul",
      "minPushes": 10,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 10,
        "boxSwitches": 5,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 40,
      "difficulty": "beginner"
    },
    {
      "id": "microban-27",
      "sourceNumber": 27,
      "rows": [
        "######",
        "#   .#",
        "# ## ##",
        "#  $$@#",
        "# #   #",
        "#.  ###",
        "#####"
      ],
      "solution": "dlulddlluuuurrrdulllddddrruulrdrruluulllddrrdruudllld",
      "minPushes": 10,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 10,
        "boxSwitches": 7,
        "goalWithdrawals": 0,
        "boxes": 2
      },
      "difficultyScore": 41,
      "difficulty": "beginner"
    },
    {
      "id": "microban-38",
      "sourceNumber": 38,
      "rows": [
        "##########",
        "#        #",
        "# ##.### #",
        "# # $$ . #",
        "# . @$## #",
        "#####    #",
        "    ######"
      ],
      "solution": "llluuurrrdduurrrrddlllrrrddlllulurrldll",
      "minPushes": 8,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 8,
        "boxSwitches": 6,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 41,
      "difficulty": "beginner"
    },
    {
      "id": "microban-5",
      "sourceNumber": 5,
      "rows": [
        " #######",
        " #     #",
        " # .$. #",
        "## $@$ #",
        "#  .$. #",
        "#      #",
        "########"
      ],
      "solution": "luurrdlullddrddrruulldrdlllur",
      "minPushes": 6,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 6,
        "boxSwitches": 5,
        "goalWithdrawals": 0,
        "boxes": 4
      },
      "difficultyScore": 41,
      "difficulty": "beginner"
    },
    {
      "id": "microban-17",
      "sourceNumber": 17,
      "rows": [
        "#####",
        "# @ #",
        "#...#",
        "#$$$##",
        "#    #",
        "#    #",
        "######"
      ],
      "solution": "dldurrdulldrddluurddrruluddluu",
      "minPushes": 9,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 9,
        "boxSwitches": 6,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 42,
      "difficulty": "beginner"
    },
    {
      "id": "microban-31",
      "sourceNumber": 31,
      "rows": [
        "  ####",
        " ##  #",
        "##@$.##",
        "# $$  #",
        "# . . #",
        "###   #",
        "  #####"
      ],
      "solution": "rurdlldurrdrddlluulur",
      "minPushes": 6,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 6,
        "boxSwitches": 3,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 42,
      "difficulty": "beginner"
    },
    {
      "id": "microban-28",
      "sourceNumber": 28,
      "rows": [
        "#####",
        "#   #",
        "# @ #",
        "# $$###",
        "##. . #",
        " #    #",
        " ######"
      ],
      "solution": "rdulldrddrruldluuluurrddldruuuldd",
      "minPushes": 9,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 9,
        "boxSwitches": 4,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 43,
      "difficulty": "initiate"
    },
    {
      "id": "microban-4",
      "sourceNumber": 4,
      "rows": [
        "########",
        "#      #",
        "# .**$@#",
        "#      #",
        "#####  #",
        "    ####"
      ],
      "solution": "ulldlurrrdllulllddrrrurrddlurul",
      "minPushes": 7,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 7,
        "boxSwitches": 3,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 43,
      "difficulty": "initiate"
    },
    {
      "id": "microban-46",
      "sourceNumber": 46,
      "rows": [
        " ######",
        "##    #",
        "#  ## #",
        "# # $ #",
        "#  * .#",
        "## #@##",
        " #   #",
        " #####"
      ],
      "solution": "dlluururdrudlllddrrudlluururrdlddlluuluururrrdd",
      "minPushes": 8,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 8,
        "boxSwitches": 5,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 45,
      "difficulty": "initiate"
    },
    {
      "id": "microban-22",
      "sourceNumber": 22,
      "rows": [
        "#####",
        "#   ###",
        "#. .  #",
        "#   # #",
        "## #  #",
        " #@$$ #",
        " #    #",
        " #  ###",
        " ####"
      ],
      "solution": "drrruuldldluuulurrdlddrrrdlullddruruldluuuruldddrruruul",
      "minPushes": 15,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 15,
        "boxSwitches": 3,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 46,
      "difficulty": "initiate"
    },
    {
      "id": "microban-20",
      "sourceNumber": 20,
      "rows": [
        "#######",
        "#     ###",
        "#  @$$..#",
        "#### ## #",
        "  #     #",
        "  #  ####",
        "  #  #",
        "  ####"
      ],
      "solution": "urdddrrruullllrddlddruuudrrruullulldrullldrurrdrullldrurrdrlulldrr",
      "minPushes": 16,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 16,
        "boxSwitches": 7,
        "goalWithdrawals": 0,
        "boxes": 2
      },
      "difficultyScore": 47,
      "difficulty": "initiate"
    },
    {
      "id": "microban-52",
      "sourceNumber": 52,
      "rows": [
        "  ####",
        "### @#",
        "#  $ #",
        "#  *.#",
        "#  *.#",
        "#  $ #",
        "###  #",
        "  ####"
      ],
      "solution": "ddlruuldllddrulurrurdlldddrdru",
      "minPushes": 8,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 8,
        "boxSwitches": 3,
        "goalWithdrawals": 1,
        "boxes": 4
      },
      "difficultyScore": 49,
      "difficulty": "initiate"
    },
    {
      "id": "microban-18",
      "sourceNumber": 18,
      "rows": [
        "#######",
        "#     #",
        "#. .  #",
        "# ## ##",
        "#  $ #",
        "###$ #",
        "  #@ #",
        "  #  #",
        "  ####"
      ],
      "solution": "ruuuulllddrrdruudllluuurrrrdllrdddddluuruuuullldddrrdruudllluuurrdlurrrdl",
      "minPushes": 13,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 13,
        "boxSwitches": 5,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 50,
      "difficulty": "initiate"
    },
    {
      "id": "microban-13",
      "sourceNumber": 13,
      "rows": [
        "####",
        "#. ##",
        "#.@ #",
        "#. $#",
        "##$ ###",
        " # $  #",
        " #    #",
        " #  ###",
        " ####"
      ],
      "solution": "rdlddrdrruldldluuuuruldlurddddrruldluuurulrddlddrruldluurul",
      "minPushes": 21,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 21,
        "boxSwitches": 5,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 51,
      "difficulty": "initiate"
    },
    {
      "id": "microban-19",
      "sourceNumber": 19,
      "rows": [
        "########",
        "#   .. #",
        "#  @$$ #",
        "##### ##",
        "   #  #",
        "   #  #",
        "   #  #",
        "   ####"
      ],
      "solution": "urrdddlddruuuurullldllurdrrurdlllurdrrddlddruuuu",
      "minPushes": 20,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 20,
        "boxSwitches": 3,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 51,
      "difficulty": "initiate"
    },
    {
      "id": "microban-15",
      "sourceNumber": 15,
      "rows": [
        "     ###",
        "######@##",
        "#    .* #",
        "#   #   #",
        "#####$# #",
        "    #   #",
        "    #####"
      ],
      "solution": "drdddlluuddrruuulllldllurrrrdddrruulrddlluu",
      "minPushes": 12,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 12,
        "boxSwitches": 2,
        "goalWithdrawals": 2,
        "boxes": 2
      },
      "difficultyScore": 52,
      "difficulty": "initiate"
    },
    {
      "id": "microban-55",
      "sourceNumber": 55,
      "rows": [
        "########",
        "# @ #  #",
        "#      #",
        "#####$ #",
        "    #  ###",
        " ## #$ ..#",
        " ## #  ###",
        "    ####"
      ],
      "solution": "rdrrrddlurulllrrrddddluuruulllulldrrrrurdddlurulllulldrrrrurddlddrrlluurdldr",
      "minPushes": 27,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 27,
        "boxSwitches": 5,
        "goalWithdrawals": 0,
        "boxes": 2
      },
      "difficultyScore": 52,
      "difficulty": "initiate"
    },
    {
      "id": "microban-50",
      "sourceNumber": 50,
      "rows": [
        "  ####",
        "###  #####",
        "#  $  @..#",
        "# $    # #",
        "### #### #",
        "  #      #",
        "  ########"
      ],
      "solution": "llulddulldrrurrrrrdddllllluulurrldddrrrrruuulldllrrurrdddllllluururdlllurdrrurdlllurdrrurldllurr",
      "minPushes": 17,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 17,
        "boxSwitches": 9,
        "goalWithdrawals": 0,
        "boxes": 2
      },
      "difficultyScore": 54,
      "difficulty": "initiate"
    },
    {
      "id": "microban-26",
      "sourceNumber": 26,
      "rows": [
        " #####",
        " # @ #",
        " #   #",
        "###$ #",
        "# ...#",
        "# $$ #",
        "###  #",
        "  ####"
      ],
      "solution": "rdddlurdddluulldrurruuulldrdrdlrddluruuluurdd",
      "minPushes": 10,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 10,
        "boxSwitches": 6,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 55,
      "difficulty": "initiate"
    },
    {
      "id": "microban-34",
      "sourceNumber": 34,
      "rows": [
        "  ####",
        "###  ####",
        "#       #",
        "#@$***. #",
        "#       #",
        "#########"
      ],
      "solution": "drudrrurdlllurrluurdldllurdrdrrrruullluld",
      "minPushes": 8,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 8,
        "boxSwitches": 5,
        "goalWithdrawals": 1,
        "boxes": 4
      },
      "difficultyScore": 55,
      "difficulty": "initiate"
    },
    {
      "id": "microban-11",
      "sourceNumber": 11,
      "rows": [
        "  ######",
        "  #    #",
        "  # ##@##",
        "### # $ #",
        "# ..# $ #",
        "#       #",
        "#  ######",
        "####"
      ],
      "solution": "ulllddddrrrruldllluuuurrrddldurrdldlllullddrulurdrudrrruuldrdlllullddrurrruuruullldd",
      "minPushes": 16,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 16,
        "boxSwitches": 6,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 56,
      "difficulty": "initiate"
    },
    {
      "id": "microban-48",
      "sourceNumber": 48,
      "rows": [
        "######",
        "#  @ #",
        "#  # ##",
        "# .#  ##",
        "# .$$$ #",
        "# .#   #",
        "####   #",
        "   #####"
      ],
      "solution": "rdddlruuullddlddruudrrurdrddlludrruulllruuulllddrduluurdurrdddddrurulll",
      "minPushes": 14,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 14,
        "boxSwitches": 5,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 56,
      "difficulty": "initiate"
    },
    {
      "id": "microban-8",
      "sourceNumber": 8,
      "rows": [
        "  ######",
        "  # ..@#",
        "  # $$ #",
        "  ## ###",
        "   # #",
        "   # #",
        "#### #",
        "#    ##",
        "# #   #",
        "#   # #",
        "###   #",
        "  #####"
      ],
      "solution": "llddddddldddrruuluuuuuuurrdlulddddddlllddrrudlluurrdddrruuluuuuuulurdddddddrddlluudlluurrdruuuuuu",
      "minPushes": 32,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 32,
        "boxSwitches": 5,
        "goalWithdrawals": 0,
        "boxes": 2
      },
      "difficultyScore": 57,
      "difficulty": "initiate"
    },
    {
      "id": "microban-39",
      "sourceNumber": 39,
      "rows": [
        "#####",
        "#   ####",
        "# # # .#",
        "#    $ ###",
        "### #$.  #",
        "#   #@   #",
        "# # ######",
        "#   #",
        "#####"
      ],
      "solution": "ruullluullddrluurrdddurrrddlurullluullddrrrrurdldrulllddllddrruuuulluurrdullddrrrrdruddrrul",
      "minPushes": 27,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 27,
        "boxSwitches": 3,
        "goalWithdrawals": 1,
        "boxes": 2
      },
      "difficultyScore": 58,
      "difficulty": "initiate"
    },
    {
      "id": "microban-14",
      "sourceNumber": 14,
      "rows": [
        "#######",
        "#     #",
        "# # # #",
        "#. $*@#",
        "#   ###",
        "#####"
      ],
      "solution": "uullllddrdrulluurrrrddlllrrruulldurrddlldllurruulld",
      "minPushes": 10,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 10,
        "boxSwitches": 5,
        "goalWithdrawals": 2,
        "boxes": 2
      },
      "difficultyScore": 59,
      "difficulty": "initiate"
    },
    {
      "id": "microban-23",
      "sourceNumber": 23,
      "rows": [
        "#######",
        "#  *  #",
        "#     #",
        "## # ##",
        " #$@.#",
        " #   #",
        " #####"
      ],
      "solution": "ruullurdrdddlluudrruululldrddrruurullrdddlluururdlllurdrrd",
      "minPushes": 10,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 10,
        "boxSwitches": 5,
        "goalWithdrawals": 2,
        "boxes": 2
      },
      "difficultyScore": 59,
      "difficulty": "initiate"
    },
    {
      "id": "microban-58",
      "sourceNumber": 58,
      "rows": [
        "####",
        "#  ####",
        "#.*$  #",
        "# .$# #",
        "## @  #",
        " #   ##",
        " #####"
      ],
      "solution": "luluurdrdulldrddrruruulllrrrddlludrruulldddlu",
      "minPushes": 11,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 11,
        "boxSwitches": 7,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 59,
      "difficulty": "amateur"
    },
    {
      "id": "microban-61",
      "sourceNumber": 61,
      "rows": [
        "########",
        "#      #",
        "# #### #",
        "# #...@#",
        "# ###$###",
        "# #     #",
        "#  $$ $ #",
        "####   ##",
        "   #.###",
        "   ###"
      ],
      "solution": "lddlddrruldluruuuruullllldddddrrrdruuuddlllluuuuurrrrrddllrdddllurdruuddlllluuuuurrrrrddldddrruldluu",
      "minPushes": 21,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 21,
        "boxSwitches": 6,
        "goalWithdrawals": 0,
        "boxes": 4
      },
      "difficultyScore": 59,
      "difficulty": "amateur"
    },
    {
      "id": "microban-42",
      "sourceNumber": 42,
      "rows": [
        "   ####",
        "   #  #",
        "   #@ #",
        "####$.#",
        "#   $.#",
        "# # $.#",
        "#    ##",
        "######"
      ],
      "solution": "rdddldllluurrruruuldddlllddrrruruuluurdlddlllddrrudlluurrrldr",
      "minPushes": 15,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 15,
        "boxSwitches": 6,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 60,
      "difficulty": "amateur"
    },
    {
      "id": "microban-10",
      "sourceNumber": 10,
      "rows": [
        "      #####",
        "      #.  #",
        "      #.# #",
        "#######.# #",
        "# @ $ $ $ #",
        "# # # # ###",
        "#       #",
        "#########"
      ],
      "solution": "rddrruullrrddrruullrruuurrdddlruuulldddllddlluurrddlllluurrddrrrruuuuddddlluurlddlluurrddrruuudddlluurlddrruu",
      "minPushes": 21,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 21,
        "boxSwitches": 9,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 63,
      "difficulty": "amateur"
    },
    {
      "id": "microban-43",
      "sourceNumber": 43,
      "rows": [
        "     ####",
        "     # @#",
        "     #  #",
        "###### .#",
        "#   $  .#",
        "#  $$# .#",
        "#    ####",
        "###  #",
        "  ####"
      ],
      "solution": "dddllldldlluurrrrrdruudllldldlulurrrrrurduluurdlddlldlddruulurrr",
      "minPushes": 22,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 22,
        "boxSwitches": 6,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 67,
      "difficulty": "amateur"
    },
    {
      "id": "microban-6",
      "sourceNumber": 6,
      "rows": [
        "###### #####",
        "#    ###   #",
        "# $$     #@#",
        "# $ #...   #",
        "#   ########",
        "#####"
      ],
      "solution": "ulldlllluldulldrrrrrrdrrruulldlllllllddrulururrdrrrrurrddlllulllulldrrrrrdrrruulldllllllddruluurrdrrrdlurrurrddlllulllulldrrrrrdrrruulldurrddll",
      "minPushes": 29,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 29,
        "boxSwitches": 8,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 68,
      "difficulty": "amateur"
    },
    {
      "id": "microban-62",
      "sourceNumber": 62,
      "rows": [
        "   ##########",
        "####    ##  #",
        "#  $$$....$@#",
        "#      ###  #",
        "#   #### ####",
        "#####"
      ],
      "solution": "llllulldrrrlldlllrruuldlddlluurrrrrrllllddlulurrrrrdllullddrulurrr",
      "minPushes": 30,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 30,
        "boxSwitches": 7,
        "goalWithdrawals": 0,
        "boxes": 4
      },
      "difficultyScore": 71,
      "difficulty": "amateur"
    },
    {
      "id": "microban-16",
      "sourceNumber": 16,
      "rows": [
        " ####",
        " #  ####",
        " #     ##",
        "## ##   #",
        "#. .# @$##",
        "#   # $$ #",
        "#  .#    #",
        "##########"
      ],
      "solution": "lddrudrrulldluuurulllulddduurrrrdrdullddrurulullllddrddluluruurrrrddlurullluldddlddrruldluruuurrrrddddrruldluuruldlurulllulddddldr",
      "minPushes": 39,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 39,
        "boxSwitches": 6,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 72,
      "difficulty": "amateur"
    },
    {
      "id": "microban-41",
      "sourceNumber": 41,
      "rows": [
        "#######",
        "#     #",
        "#@$$$ ##",
        "#  #...#",
        "##    ##",
        " ######"
      ],
      "solution": "urdurrdulldrurrdddllluluurrdrullldrrurrdulldrllddrrurdllluuurrdurd",
      "minPushes": 13,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 13,
        "boxSwitches": 11,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 73,
      "difficulty": "amateur"
    },
    {
      "id": "microban-32",
      "sourceNumber": 32,
      "rows": [
        " ####",
        "##  ###",
        "#     #",
        "#.**$@#",
        "#   ###",
        "##  #",
        " ####"
      ],
      "solution": "ulldullddrururrdlllddruluruuldrrrdl",
      "minPushes": 9,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 9,
        "boxSwitches": 5,
        "goalWithdrawals": 3,
        "boxes": 3
      },
      "difficultyScore": 75,
      "difficulty": "amateur"
    },
    {
      "id": "microban-53",
      "sourceNumber": 53,
      "rows": [
        " #####",
        "##. .##",
        "# * * #",
        "#  #  #",
        "# $ $ #",
        "## @ ##",
        " #####"
      ],
      "solution": "luluururrdrddldlluuudddrruruullrrddluudddllurdruu",
      "minPushes": 12,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 12,
        "boxSwitches": 7,
        "goalWithdrawals": 2,
        "boxes": 4
      },
      "difficultyScore": 77,
      "difficulty": "amateur"
    },
    {
      "id": "microban-49",
      "sourceNumber": 49,
      "rows": [
        "######",
        "# @  #",
        "# $# #",
        "# $  #",
        "# $ ##",
        "### ####",
        " #  #  #",
        " #...  #",
        " #     #",
        " #######"
      ],
      "solution": "lddrluurdlddrluurduurrddldddldrrluuuuruulldlddrluurdrdddlddrrulrdrruldlluuuuulldrurddd",
      "minPushes": 21,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 21,
        "boxSwitches": 10,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 78,
      "difficulty": "amateur"
    },
    {
      "id": "microban-57",
      "sourceNumber": 57,
      "rows": [
        "  ####",
        "  #  #",
        "  #@ #",
        "  #  #",
        "### ####",
        "#    * #",
        "#  $   #",
        "#####. #",
        "    ####"
      ],
      "solution": "dddrdrrulldluuuddlldrrruluuruulddddldrurrrddlurullldllurdrrurdlllurr",
      "minPushes": 23,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 23,
        "boxSwitches": 7,
        "goalWithdrawals": 2,
        "boxes": 2
      },
      "difficultyScore": 78,
      "difficulty": "amateur"
    },
    {
      "id": "microban-47",
      "sourceNumber": 47,
      "rows": [
        "  #######",
        "###     #",
        "# $ $   #",
        "# ### #####",
        "# @ . .   #",
        "#   ###   #",
        "##### #####"
      ],
      "solution": "rrruuulldrrddlllluurrrurdduurrdluldllllddrrrrrrdrrulllllldlluuurrrrdulllldddrrurrlldllurr",
      "minPushes": 22,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 22,
        "boxSwitches": 5,
        "goalWithdrawals": 3,
        "boxes": 2
      },
      "difficultyScore": 83,
      "difficulty": "amateur"
    },
    {
      "id": "microban-37",
      "sourceNumber": 37,
      "rows": [
        "      ###",
        "##### #.#",
        "#   ###.#",
        "#   $ #.#",
        "# $  $  #",
        "#####@# #",
        "    #   #",
        "    #####"
      ],
      "solution": "drruullulldrulullddrluurrdrdrullullddrruuldrrrdrlulldrullldrurrdrullldrurrdddrruuuuddddlluurlulldrrddrruuudddlluurlddrruu",
      "minPushes": 23,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 23,
        "boxSwitches": 16,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 86,
      "difficulty": "amateur"
    },
    {
      "id": "microban-54",
      "sourceNumber": 54,
      "rows": [
        "      ######",
        "      #    #",
        "  ##### .  #",
        "###  ###.  #",
        "# $  $  . ##",
        "# @$$ # . #",
        "##    #####",
        " ######"
      ],
      "solution": "druruuldrddllulurddrruurrrdruuruulldrddllllddlluurrrrrdruudllllddlulurrrrrdrruuldurruulldurrdlddlllllddrulurrr",
      "minPushes": 30,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 30,
        "boxSwitches": 9,
        "goalWithdrawals": 1,
        "boxes": 4
      },
      "difficultyScore": 89,
      "difficulty": "amateur"
    },
    {
      "id": "microban-79",
      "source": "microban",
      "sourceNumber": 79,
      "solution": "llldllurrluurddrrrdrulllluurrdullddrrdrrulllrrrruuldrdll",
      "solutionPushes": 18,
      "searchNodes": 53,
      "rows": [
        " #########",
        " #    #  #",
        "## $#$#  #",
        "#  .$.@  #",
        "#  .#    #",
        "##########"
      ],
      "difficultyMetrics": {
        "pushes": 18,
        "boxSwitches": 4,
        "goalWithdrawals": 5,
        "boxes": 3
      },
      "difficultyScore": 105,
      "difficulty": "amateur"
    },
    {
      "id": "sasquatch-1-8",
      "source": "sasquatch-1",
      "sourceNumber": 8,
      "solution": "urrrruurrrrddrduulullllddrddlludrruuluurrrrddrdrddddlllllllulululuurrrdrlulllddrdrdrdrrrrrrruuuuluulullllddllldrurruurrrrddrdrddddlluurdrudlldlllllulululuurrrruurrrrddrdddrddlruulldrddlulllllulululur",
      "solutionPushes": 17,
      "searchNodes": 41598,
      "solutionId": 353,
      "boxSwitches": 14,
      "difficultyScore": 106,
      "rows": [
        "    #######",
        "    #     ##",
        "##### ###  ##",
        "#       #  ##",
        "#@$***. ##$ #",
        "#  #    ## .#",
        "##  ##  # $ #",
        " ##  ####.$.#",
        "  ##        #",
        "   ######  ##",
        "        ####"
      ],
      "difficultyMetrics": {
        "pushes": 17,
        "boxSwitches": 14,
        "goalWithdrawals": 1,
        "boxes": 7
      },
      "difficulty": "amateur"
    },
    {
      "id": "sasquatch-2-34",
      "source": "sasquatch-2",
      "sourceNumber": 34,
      "solution": "rulrdrrulrurrddlllrrddlludrruululldurrdrddlluuruldlllllddlluurrrldrurrlllluurrdullddrr",
      "solutionPushes": 22,
      "searchNodes": 1175,
      "boxSwitches": 11,
      "difficultyScore": 107,
      "rows": [
        " #####  #####",
        " #   ####   #",
        "## #$.*.$ # #",
        "#   $.@.$   #",
        "# # $.*.$# ##",
        "#   ####   #",
        "#####  #####"
      ],
      "difficultyMetrics": {
        "pushes": 22,
        "boxSwitches": 11,
        "goalWithdrawals": 1,
        "boxes": 8
      },
      "difficulty": "amateur"
    },
    {
      "id": "microban-63",
      "source": "microban",
      "sourceNumber": 63,
      "solution": "llllllulllllllulldrurdrrrrrrrddlurulllllllulldrrrddlururrrrrurdlllllllulldrrrrrrrrdrudrrrrrdrrullllll",
      "solutionPushes": 50,
      "searchNodes": 135,
      "rows": [
        "#####   ####",
        "#   ##### .#",
        "#       $  ########",
        "###  #### .$    @ #",
        "  #  #  #  ####   #",
        "  ####  ####  #####"
      ],
      "difficultyMetrics": {
        "pushes": 50,
        "boxSwitches": 8,
        "goalWithdrawals": 2,
        "boxes": 2
      },
      "difficultyScore": 108,
      "difficulty": "amateur"
    },
    {
      "id": "sasquatch-5-13",
      "source": "sasquatch-5",
      "sourceNumber": 13,
      "solution": "dddrruurrllddlluuururldldddrruurrdlululldrrllddrrudlluuuruurdlddlddrrurruuulrdrrulldddruluurrdluldurruullddrdddllldlluuuruurrlldddlddrrurrruuuruulld",
      "solutionPushes": 20,
      "searchNodes": 5137,
      "boxSwitches": 12,
      "rows": [
        "    #####",
        " ####   #",
        " #  $$# #",
        "## *..$ #",
        "#@ .#.  #",
        "# $..* ##",
        "# #$$  #",
        "#   ####",
        "#####"
      ],
      "difficultyMetrics": {
        "pushes": 20,
        "boxSwitches": 12,
        "goalWithdrawals": 1,
        "boxes": 8
      },
      "difficultyScore": 108,
      "difficulty": "expert"
    },
    {
      "id": "microban-60",
      "sourceNumber": 60,
      "rows": [
        " #########",
        " #       #",
        "##@##### #",
        "#  #   # #",
        "#  #   $.#",
        "#  ##$##.#",
        "##$##  #.#",
        "#   $  #.#",
        "#   #  ###",
        "########"
      ],
      "solution": "urrrrrrdddllulldrrrllddrddluuuddlldlluruuluuruurrrrrrddddduuuuullllllddlddrddrrlluuluurddduuuuurrrrrrdddllulldrrrllddrddluuuddlldlluruuuuuurrrrrrdddduuuullllllddddddrrlluuuuuurrrrrrdddllulldrrrllddrddlullluuuuuurrrrrrddduuullllllddddddrrruuddllluuuuuurrrrrrdddllulldrrr",
      "minPushes": 44,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 44,
        "boxSwitches": 15,
        "goalWithdrawals": 0,
        "boxes": 4
      },
      "difficultyScore": 109,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-7-5",
      "source": "sasquatch-7",
      "sourceNumber": 5,
      "solution": "rrdrrddrdrruuullulddurrrdddlllrrruuulllllulldrdurrrddrdrruuulluldlllddrdlldlurruuurrrrrrdddllullrrdrruuulllllldddrdrururrddlulllluuurrrdduullldddrrrrdru",
      "solutionPushes": 29,
      "searchNodes": 5864,
      "boxSwitches": 15,
      "difficultyScore": 109,
      "rows": [
        "  ########",
        "  #@  #  ###",
        "  # $  $   #",
        "####$##$## #",
        "# .* .* .*.#",
        "#          #",
        "##  #  #  ##",
        " ##########"
      ],
      "difficultyMetrics": {
        "pushes": 29,
        "boxSwitches": 15,
        "goalWithdrawals": 0,
        "boxes": 7
      },
      "difficulty": "expert"
    },
    {
      "id": "microban-29",
      "sourceNumber": 29,
      "rows": [
        "     #####",
        "     #   ##",
        "     #    #",
        " ######   #",
        "##     #. #",
        "# $ $ @  ##",
        "# ######.#",
        "#        #",
        "##########"
      ],
      "solution": "ullldrurrdrrddllllllluururrdrullldrurrdrullldrurrdrlulldrrlllllddrrrrrrruuuuruldddddllllllluurrrrrrllllllddrrrrrrruuuruulduulldrdrduluurdrddlduruuld",
      "minPushes": 22,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 22,
        "boxSwitches": 14,
        "goalWithdrawals": 3,
        "boxes": 2
      },
      "difficultyScore": 110,
      "difficulty": "expert"
    },
    {
      "id": "microban-96",
      "source": "microban",
      "sourceNumber": 96,
      "solution": "rrdrrulllrrdddlldlluruuullulldrrrruuruldddrrdrrulllrrdddlldllurrrlluuuuuruuldddduuuulldrurdd",
      "solutionPushes": 37,
      "searchNodes": 957,
      "rows": [
        "  ######",
        "  #    #",
        "  #    #",
        "#####  #",
        "#   #.#####",
        "#   $@$   #",
        "#####.#   #",
        "   ## ## ##",
        "   #   $.#",
        "   #   ###",
        "   #####"
      ],
      "difficultyMetrics": {
        "pushes": 37,
        "boxSwitches": 8,
        "goalWithdrawals": 3,
        "boxes": 3
      },
      "difficultyScore": 112,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-4-5",
      "source": "sasquatch-4",
      "sourceNumber": 5,
      "solution": "uuludrruluulldrurdddllururdrdrrululruldrdl",
      "solutionPushes": 19,
      "searchNodes": 2680,
      "solutionId": 634,
      "boxSwitches": 12,
      "rows": [
        " ####",
        " #  #",
        "## .###",
        "#  .$ #",
        "#* *  ##",
        "# $.$$ #",
        "#  .   #",
        "###*####",
        "  #@#",
        "  ###"
      ],
      "difficultyMetrics": {
        "pushes": 19,
        "boxSwitches": 12,
        "goalWithdrawals": 2,
        "boxes": 7
      },
      "difficultyScore": 114,
      "difficulty": "expert"
    },
    {
      "id": "microban-35",
      "sourceNumber": 35,
      "rows": [
        "  ####",
        " ##  #",
        " #. $#",
        " #.$ #",
        " #.$ #",
        " #.$ #",
        " #. $##",
        " #   @#",
        " ##   #",
        "  #####"
      ],
      "solution": "lluluurduluurdlddrrdulluurrduluurdldlddrurdulluurrdullddruruldddlddruudddrruldluluurrdulluurrdullddrurulrddllddruurulddddrruldluluurrdullddruruldddrruldlurul",
      "minPushes": 31,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 31,
        "boxSwitches": 20,
        "goalWithdrawals": 0,
        "boxes": 5
      },
      "difficultyScore": 116,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-6-2",
      "source": "sasquatch-6",
      "sourceNumber": 2,
      "solution": "ululluurrdullddrdrrrrruruullldurrrddldllllluluurrddldrdrrurruruullldlrurrrddldlldlluulluurrdullddrdrdrrullrrrruruullldduurrrddldlluuurrdllddrrurulluldrrddlldlluulldruluurrdrrduurrdluld",
      "solutionPushes": 25,
      "searchNodes": 594,
      "boxSwitches": 14,
      "rows": [
        "##########",
        "#   #    #",
        "# #$$$$$ #",
        "#  .#.#  #",
        "#  ...  ##",
        "### @ ###",
        "  #####"
      ],
      "difficultyMetrics": {
        "pushes": 25,
        "boxSwitches": 14,
        "goalWithdrawals": 2,
        "boxes": 5
      },
      "difficultyScore": 116,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-7-8",
      "source": "sasquatch-7",
      "sourceNumber": 8,
      "solution": "ldllrrurudldllulldrururruulldurrdddrrdluluuurrdluldulldllurr",
      "solutionPushes": 12,
      "searchNodes": 3821,
      "boxSwitches": 8,
      "rows": [
        "#########",
        "# $ .   #",
        "#   #   #",
        "#*** ***#",
        "#   # @ #",
        "#  .$.$ #",
        "#########"
      ],
      "difficultyMetrics": {
        "pushes": 12,
        "boxSwitches": 8,
        "goalWithdrawals": 3,
        "boxes": 9
      },
      "difficultyScore": 117,
      "difficulty": "expert"
    },
    {
      "id": "microban-87",
      "source": "microban",
      "sourceNumber": 87,
      "solution": "lurluurdllluruulurrrrdllldddrruldluudrdddrudrrulldluluurrdullddrdrrululrddluruulluulurrrdrrruuldrdlllurdrruuldrdllullldddrrddludluuuulurrrrdrruuldrdlullllddddrruldluuulurrrrrurd",
      "solutionPushes": 53,
      "searchNodes": 4667,
      "rows": [
        "     ####",
        "######  #",
        "#       #",
        "#  ... .#",
        "##$######",
        "# $  #",
        "#   $###",
        "##  $  #",
        " ## @  #",
        "  ######"
      ],
      "difficultyMetrics": {
        "pushes": 53,
        "boxSwitches": 15,
        "goalWithdrawals": 0,
        "boxes": 4
      },
      "difficultyScore": 118,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-5-2",
      "source": "sasquatch-5",
      "sourceNumber": 2,
      "solution": "ldrrdddrruuulrdddlldllluurrllddrrurrruuulldduulrddldruuulddrddllluurrllddrruruddllluurruurrrdddlruuulllulldrr",
      "solutionPushes": 20,
      "searchNodes": 538,
      "boxSwitches": 14,
      "rows": [
        "#####",
        "#  @####",
        "#  $.  #",
        "###$.# #",
        "#  $.# #",
        "# #$.  #",
        "#    ###",
        "######"
      ],
      "difficultyMetrics": {
        "pushes": 20,
        "boxSwitches": 14,
        "goalWithdrawals": 3,
        "boxes": 4
      },
      "difficultyScore": 118,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-7-20",
      "source": "sasquatch-7",
      "sourceNumber": 20,
      "solution": "uuruulddllurdrruuluurdlllurdrddrrruulldurrddlluurdrdluuruuuruulddddrdldlluuldllurdrrdrruuuuulllldduurrrrddddldlu",
      "solutionPushes": 27,
      "searchNodes": 7599,
      "boxSwitches": 14,
      "rows": [
        "     ####",
        " #####  #",
        " #      #",
        " # ###  #",
        "##$* # ##",
        "# *..#  #",
        "#   $$$ #",
        "##*. $ ##",
        "# $*.  #",
        "#  . ###",
        "## . #",
        " # @##",
        " ####"
      ],
      "difficultyMetrics": {
        "pushes": 27,
        "boxSwitches": 14,
        "goalWithdrawals": 0,
        "boxes": 10
      },
      "difficultyScore": 119,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-5-1",
      "source": "sasquatch-5",
      "sourceNumber": 1,
      "solution": "rdluuuuulldrurddddllurdrrddluruluuuruldlluurdldrurddddrruldlurdddluruulllddrrdruruulluuruldlluurdrddddullddrrurlddrululuruuulldrurdddrdlddru",
      "solutionPushes": 41,
      "searchNodes": 1755,
      "boxSwitches": 16,
      "rows": [
        "####",
        "#  ###",
        "#    #",
        "# $  #",
        "### ###",
        "# $ $ #",
        "#..@..#",
        "#  $  #",
        "###  ##",
        "  ####"
      ],
      "difficultyMetrics": {
        "pushes": 41,
        "boxSwitches": 16,
        "goalWithdrawals": 1,
        "boxes": 4
      },
      "difficultyScore": 121,
      "difficulty": "expert"
    },
    {
      "id": "microban-59",
      "sourceNumber": 59,
      "rows": [
        "############",
        "#          #",
        "# ####### @##",
        "# #         #",
        "# #  $   #  #",
        "# $$ #####  #",
        "###  # # ...#",
        "  #### #    #",
        "       ######"
      ],
      "solution": "dlllllldrrllddluruurrrrruullllllllddddrrdrullluuuurrrrrrrrddlllllldrurrrrruullllllllddddrrdruulurrrrrrurdlllldlullddrulurrrrrdlllullddrulurrrdlldllluuuurrrrrrrrrddddrddllurdruuluuuulllllllllddddrrurrrrrurldllurrdlllldllluuuurrrrrrrrrddddrdluuuuulllllllllddddrruurrrrrrurddurdldurd",
      "minPushes": 50,
      "source": "microban",
      "difficultyMetrics": {
        "pushes": 50,
        "boxSwitches": 15,
        "goalWithdrawals": 1,
        "boxes": 3
      },
      "difficultyScore": 122,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-4-7",
      "source": "sasquatch-4",
      "sourceNumber": 7,
      "solution": "dllllluurrrrudlllluurduuurrrrrrrrddlllllllrrrrrrruullllllllddrrrrrrrrrddlllludrrrruulduuullllllllddrrrrrrrllllllluurrrrrrrrddrdrruululrdrddllullllddrrrllluullllllddddrrrrrrrrrruulllluullddlllrrruulllldlluururldlddrrurrrrrrddrrrrddlllllllllluu",
      "solutionPushes": 18,
      "searchNodes": 133706,
      "solutionId": 693,
      "boxSwitches": 10,
      "difficultyScore": 122,
      "rows": [
        " ###############",
        "## $.       .$ ##",
        "#  # ####### #  #",
        "# #           # #",
        "#  .***$#$***.  #",
        "###     #     ###",
        "  # ####@#### #",
        "  #           #",
        "  #############"
      ],
      "difficultyMetrics": {
        "pushes": 18,
        "boxSwitches": 10,
        "goalWithdrawals": 2,
        "boxes": 10
      },
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-7-7",
      "source": "sasquatch-7",
      "sourceNumber": 7,
      "solution": "ullluuruuldrrrdduulldduurrddlddrudllluuulldrurrurrdrdlddlllurdrruuuulldduurrddlrddllluulurdddrrruuuulluldrrrddddllluurudllurdddrrruuldrdl",
      "solutionPushes": 22,
      "searchNodes": 950,
      "boxSwitches": 17,
      "rows": [
        "  ####",
        "  #  ###",
        "### .  ##",
        "#   .#  #",
        "# $$*$$ #",
        "### .  ##",
        "  # . @#",
        "  ######"
      ],
      "difficultyMetrics": {
        "pushes": 22,
        "boxSwitches": 17,
        "goalWithdrawals": 2,
        "boxes": 5
      },
      "difficultyScore": 122,
      "difficulty": "expert"
    },
    {
      "id": "microban-65",
      "source": "microban",
      "sourceNumber": 65,
      "solution": "uuuulrddddlluururuuldulldrurrdddduuuulldrurdddllddrdrrullluurrdullddrdrrullruulldllurrrldllddruluurrdllurrruruulldrdrduluurdlddldldrrdrrulllullddrulururrrduluurdldllddrrdrrulllrruuluurdddullldlddrurrdrrulllldlu",
      "solutionPushes": 49,
      "searchNodes": 396,
      "rows": [
        "  ######",
        "  #    #",
        "  #  $ #",
        " ####$ #",
        "## $ $ #",
        "#....# ##",
        "#     @ #",
        "##  #   #",
        " ########"
      ],
      "difficultyMetrics": {
        "pushes": 49,
        "boxSwitches": 19,
        "goalWithdrawals": 0,
        "boxes": 4
      },
      "difficultyScore": 126,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-4-10",
      "source": "sasquatch-4",
      "sourceNumber": 10,
      "solution": "dluulllddrurlluurduluururuulrddldlddddruuluururuulduullddrddddrddluuuudddrrrruuldrdllrrddlulrruuldrdlullulduuuu",
      "solutionPushes": 27,
      "searchNodes": 7081,
      "solutionId": 647,
      "boxSwitches": 14,
      "difficultyScore": 128,
      "rows": [
        "######",
        "#    #",
        "# .$ #",
        "# ** #",
        "##$. #",
        " #  ####",
        " # ##  #",
        " #  #  #",
        " #     #",
        " #.**$@#",
        " #  #  #",
        " #######"
      ],
      "difficultyMetrics": {
        "pushes": 27,
        "boxSwitches": 14,
        "goalWithdrawals": 2,
        "boxes": 7
      },
      "difficulty": "expert"
    },
    {
      "id": "microban-100",
      "source": "microban",
      "sourceNumber": 100,
      "solution": "lddrduluurdrrrdldddrruulrddlluurrdluuullllddrudlddruuluurrrurdddlurdrddlludrruuluulrddrddlluurrdluuullluldddrulurrrurdddlurdrddlluurrdluuulllulddurrrrddlurullluldrrrrddddluuurulll",
      "solutionPushes": 52,
      "searchNodes": 2560,
      "rows": [
        "#######",
        "# @#  #",
        "#.$   #",
        "#. # $##",
        "#.$#   #",
        "#. # $ #",
        "#  #   #",
        "########"
      ],
      "difficultyMetrics": {
        "pushes": 52,
        "boxSwitches": 19,
        "goalWithdrawals": 0,
        "boxes": 4
      },
      "difficultyScore": 129,
      "difficulty": "expert"
    },
    {
      "id": "microban-89",
      "source": "microban",
      "sourceNumber": 89,
      "solution": "urrddlruulldddddlluuuurlddddrrruluurruullddddrddlruuluuulllulldrrrrlddddrruuurruullddullddddrrurudldlluuuurrdduullddddrrdruudllluuuurrdddrdluuuuurrddlruullddddruluuurrddlddddluruuuruulldlldddddrluuuuurrurrddldddlldluudrrruuldururuulldddrddlldlurrruuldrdllrrdll",
      "solutionPushes": 47,
      "searchNodes": 5060,
      "rows": [
        "##########",
        "#   ##   #",
        "# $  $@# #",
        "#### # $ #",
        "   #.#  ##",
        " # #.# $#",
        " # #.   #",
        " # #.   #",
        "   ######"
      ],
      "difficultyMetrics": {
        "pushes": 47,
        "boxSwitches": 21,
        "goalWithdrawals": 0,
        "boxes": 4
      },
      "difficultyScore": 130,
      "difficulty": "expert"
    },
    {
      "id": "sasquatch-7-9",
      "source": "sasquatch-7",
      "sourceNumber": 9,
      "solution": "urrrrurrdddlllrrruuulldlllldddrrdrullluuurrdduurrurrdddlludldlurrrruuulldllllddrrlldruluurrrruuldrrrdddlluu",
      "solutionPushes": 16,
      "searchNodes": 4891,
      "boxSwitches": 12,
      "rows": [
        "   ####",
        "   #  ###",
        "####$.  #",
        "#   * . #",
        "#@#.#$# #",
        "# $ *   #",
        "#  .$####",
        "###  #",
        "  ####"
      ],
      "difficultyMetrics": {
        "pushes": 16,
        "boxSwitches": 12,
        "goalWithdrawals": 4,
        "boxes": 6
      },
      "difficultyScore": 130,
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-4-1",
      "source": "sasquatch-4",
      "sourceNumber": 1,
      "solution": "uuuluurddddrrruuldrdllddlluruuuururrdulldldddrruurrululldllurddddrruururrrddlullddllluuuurrldldddrruurrrruldllddllluuuurrurddulldldddrruurddlllddruluuuuurrrddddlldlurruurrrurdlllddllluuururrdrlulldllurrrurdlldldddrruurrrrrdlulllddllluuuurrrdulldldddrruurr",
      "solutionPushes": 43,
      "searchNodes": 2639,
      "solutionId": 576,
      "boxSwitches": 17,
      "difficultyScore": 133,
      "rows": [
        "   ####",
        "####  #",
        "#     ####",
        "# $ #  . ##",
        "#  #   .  #",
        "## #$$#.  #",
        "##    #####",
        "# @ ###",
        "#   #",
        "#####"
      ],
      "difficultyMetrics": {
        "pushes": 43,
        "boxSwitches": 17,
        "goalWithdrawals": 2,
        "boxes": 3
      },
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-1-20",
      "source": "sasquatch-1",
      "sourceNumber": 20,
      "solution": "ulldddrrurldlluuurrdulldddrrrururdululldrurdrrulruuldddllddllluurrllddrurururrdrullldrrllldllurrrrllddrulurlllurrrrr",
      "solutionPushes": 36,
      "searchNodes": 912787,
      "solutionId": 698,
      "boxSwitches": 18,
      "difficultyScore": 135,
      "rows": [
        "     ####",
        "     #  #",
        "######$.#",
        "#   $ $.#",
        "# $@$...#",
        "# $$$..##",
        "#  $ ..#",
        "########"
      ],
      "difficultyMetrics": {
        "pushes": 36,
        "boxSwitches": 18,
        "goalWithdrawals": 0,
        "boxes": 9
      },
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-6-3",
      "source": "sasquatch-6",
      "sourceNumber": 3,
      "solution": "ulullllldlddrdrrruulduuulldrllddrrurrdlrddlururdlllluluururrrdduurrdlulllldlddrdrrrruuddlllluluururrrrrdrddl",
      "solutionPushes": 14,
      "searchNodes": 5307,
      "boxSwitches": 11,
      "rows": [
        " ########",
        "##      ##",
        "#  *..*  #",
        "# #$  $#@#",
        "#  ****  #",
        "##     ###",
        " ###  ##",
        "   ####"
      ],
      "difficultyMetrics": {
        "pushes": 14,
        "boxSwitches": 11,
        "goalWithdrawals": 4,
        "boxes": 8
      },
      "difficultyScore": 135,
      "difficulty": "expertPlus"
    },
    {
      "id": "microban-69",
      "source": "microban",
      "sourceNumber": 69,
      "solution": "urrrurrrdrrddludluudrrululuurddllluldrdllrrddllluluurdrrurrrrdrddluludrrulullluldrdlurrrrddlurullldddllluuudddrrruullrruuldrdddllluluurdrrlluluurddldrdldrr",
      "solutionPushes": 41,
      "searchNodes": 922,
      "rows": [
        "####  ####",
        "#  ####  #",
        "#  #  #  #",
        "#  #    $##",
        "#  . .#$  #",
        "#@ ## # $ #",
        "#   . #   #",
        "###########"
      ],
      "difficultyMetrics": {
        "pushes": 41,
        "boxSwitches": 19,
        "goalWithdrawals": 2,
        "boxes": 3
      },
      "difficultyScore": 137,
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-1-15",
      "source": "sasquatch-1",
      "sourceNumber": 15,
      "solution": "dddddrdddrruuuuurrddlruulldddddlluuulldrurrrdddlluuddrruuulldlluururduluurdlddlddruuuurdldddrddrruuulldlluururdllddruuddrddrruuullulldlldrrrluurrdrrdddlluuludrddrruuulllrrruurrddlllluuulldurruuld",
      "solutionPushes": 36,
      "searchNodes": 500294,
      "solutionId": 697,
      "boxSwitches": 18,
      "difficultyScore": 137,
      "rows": [
        "   ####",
        "   #@ #",
        "  ##  ##",
        "  # .$#####",
        "  #$. #   #",
        "###..$# # #",
        "#  ..$  $ #",
        "# $ $ # ###",
        "##### # #",
        "    #   #",
        "    ###.#",
        "      ###"
      ],
      "difficultyMetrics": {
        "pushes": 36,
        "boxSwitches": 18,
        "goalWithdrawals": 1,
        "boxes": 7
      },
      "difficulty": "expertPlus"
    },
    {
      "id": "microban-77",
      "source": "microban",
      "sourceNumber": 77,
      "solution": "ddddrruldluuuddrrrrrulrdrruldlllllluururrrrrddrdlllllrrurdlllurrdlldlluuururrrrrddrdlllurlllddlluuururrrrrddrdluuullllldllurrdldddrruldluuururrrllldllurrrrlldlddrrurrdlurrrdlulldlurrrdlulldlrurrdlldlluuulurrdldddrruldluuururldllurr",
      "solutionPushes": 55,
      "searchNodes": 1531,
      "rows": [
        "##########",
        "# @ .... #",
        "#   ####$##",
        "## #  $ $ #",
        " # $      #",
        " #   ######",
        " #####"
      ],
      "difficultyMetrics": {
        "pushes": 55,
        "boxSwitches": 21,
        "goalWithdrawals": 0,
        "boxes": 4
      },
      "difficultyScore": 138,
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-5-10",
      "source": "sasquatch-5",
      "sourceNumber": 10,
      "solution": "luuurrrrdulldrullldrlddruluuururrrrrdrdddlddldlllluluuruurrdlurrrdllulllddddrdrrrruruuruuulullllldldddrdrrrudllluluurlddrdrrruuddllluluurdlddrrrruululrdrddlllluuuururrrrrdrdddlddldlllluluuururrdlrrrulll",
      "solutionPushes": 23,
      "searchNodes": 1373,
      "boxSwitches": 18,
      "rows": [
        " ########",
        "##      ##",
        "# .####  #",
        "# .    # #",
        "# * $$ # #",
        "# *## #  #",
        "# +   # ##",
        "# $###  #",
        "##     ##",
        " #######"
      ],
      "difficultyMetrics": {
        "pushes": 23,
        "boxSwitches": 18,
        "goalWithdrawals": 3,
        "boxes": 5
      },
      "difficultyScore": 138,
      "difficulty": "expertPlus"
    },
    {
      "id": "microban-84",
      "source": "microban",
      "sourceNumber": 84,
      "solution": "urlddrluurdrdduuruluullllddddddrrrruuullurdrdddlllluuuuuurrrrddddulldruuruullllddddddrrrrrrdrrullllllldluuuuuluurrrrrddrddlduulldrurduuuulllllddrddddrrrrrrdrrulllllldlluuuuuluurrrrrddddduuuuulllllddruddddddrruldluuuuuluurrrlllddrulurrlddddddrrrrrrdrrullllllldluuuuuulur",
      "solutionPushes": 70,
      "searchNodes": 2030,
      "rows": [
        "########",
        "#  ... #",
        "#  ### ##",
        "#  # $  #",
        "## #@$  #",
        " # # $  #",
        " # ### #####",
        " #         #",
        " #   ###   #",
        " ##### #####"
      ],
      "difficultyMetrics": {
        "pushes": 70,
        "boxSwitches": 18,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 139,
      "difficulty": "expertPlus"
    },
    {
      "id": "microban-80",
      "source": "microban",
      "sourceNumber": 80,
      "solution": "lddrudrruluuullluuddrrrudddddllurdrruuluullluuluurdrrdrddllluuddrrruurrurddulllddddrddluuuuuddddllurdruuullluuluurdrrdrrrdrudlddruluullddllluuddrrrddrddluuuuudllluuluurdrrdrddllluulurdddrrruurr",
      "solutionPushes": 46,
      "searchNodes": 2250,
      "rows": [
        "####",
        "#  #######",
        "#  . ## .#",
        "# $#    .#",
        "## ## # .#",
        " #    #  #",
        " #### #  #",
        "  # @$ ###",
        "  # $$ #",
        "  #    #",
        "  ######"
      ],
      "difficultyMetrics": {
        "pushes": 46,
        "boxSwitches": 21,
        "goalWithdrawals": 1,
        "boxes": 4
      },
      "difficultyScore": 141,
      "difficulty": "expertPlus"
    },
    {
      "id": "microban-76",
      "source": "microban",
      "sourceNumber": 76,
      "solution": "rddrddrrrruulduuuurrdluldddrddlruuudddllldlurrrruuuluurrdlddddlllludrrrruuuuuldrddddlllluluuuuurrddddlddrrrruuldrdllldluuluuluuurrrddddlruuuulldlddruluurrrddddldluluurudlddruuluurlddrddrddrrruuruuldddrdllldluuluuuluururrdddddldluluuuurrllddrulururrdduulldddlddruluuururrddduuulldrurddulldlddruulurrurd",
      "solutionPushes": 56,
      "searchNodes": 571,
      "rows": [
        " #####",
        "##   #",
        "#    #####",
        "#  #.#   #",
        "#@ #.# $ #",
        "#  #.#  ##",
        "#    #  #",
        "##  ##$$#",
        " ##     #",
        "  #  ####",
        "  ####"
      ],
      "difficultyMetrics": {
        "pushes": 56,
        "boxSwitches": 25,
        "goalWithdrawals": 0,
        "boxes": 3
      },
      "difficultyScore": 146,
      "difficulty": "expertPlus"
    },
    {
      "id": "microban-85",
      "source": "microban",
      "sourceNumber": 85,
      "solution": "luuuurrurrdrullldllurdrrurrdllllurrllldddduuurrrrrurrdllllurrdrruuldrdllulldlurrrdlullllddddldrrrrlddrruulllluuuuurrdlurrrdllullddddldrrruurrddlruullddlluuuuurrdlulddddldrrrllddrrrruuurulddddlllluurrdullddrr",
      "solutionPushes": 57,
      "searchNodes": 898,
      "rows": [
        "       ####",
        " #######  #",
        " # $      #",
        " #   $ $  #",
        " # ########",
        "## # .  #",
        "#  # #  #",
        "#  @ . ##",
        "## # # #",
        " #   . #",
        " #######"
      ],
      "difficultyMetrics": {
        "pushes": 57,
        "boxSwitches": 17,
        "goalWithdrawals": 2,
        "boxes": 3
      },
      "difficultyScore": 147,
      "difficulty": "expertPlus"
    },
    {
      "id": "microban-78",
      "source": "microban",
      "sourceNumber": 78,
      "solution": "uurruulldrurrrddduuulllddrrlluurdldruurrdduullddrlullldrddrrrrrrlllllluuuurrrrdrdlduuullddrluurrddllurllldddrrrrlllluurlddrrrrrllllluuurrrdrduluurdllldlddrrrdrruldllulluuurrrrdullldrllddrrdrruldlluluuurrrrdduulldllddrdrrurdlllurlluurrrurdd",
      "solutionPushes": 35,
      "searchNodes": 439,
      "rows": [
        " #######",
        "##     ##",
        "#  $ $  #",
        "# $ $ $ #",
        "## ### ####",
        " #@  .....#",
        " ##     ###",
        "  #######"
      ],
      "difficultyMetrics": {
        "pushes": 35,
        "boxSwitches": 26,
        "goalWithdrawals": 1,
        "boxes": 5
      },
      "difficultyScore": 150,
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-4-21",
      "source": "sasquatch-4",
      "sourceNumber": 21,
      "solution": "uluulldldlddrrurldlluurururrddrddlulldllurrrrdddlluulurrldddrruurrddrrudlluullddlluuuluurdldrdddrruurruuldrdddrrururuulldlrurrddldldlluuluuruurrddrdluuullddlddrudddrrurudldlluuuuddddrrururuulldlrurrddldldlluuluurdrrurrdlllruuulldurrdddrddlurul",
      "solutionPushes": 32,
      "searchNodes": 825440,
      "solutionId": 672,
      "boxSwitches": 18,
      "difficultyScore": 150,
      "rows": [
        "  #########",
        " ##   #   #",
        "## $# # #$###",
        "#   #. .#   #",
        "# $ *.@.* $ #",
        "#   #. .#   #",
        "###$# # #$ ##",
        "  #   #   ##",
        "  #########"
      ],
      "difficultyMetrics": {
        "pushes": 32,
        "boxSwitches": 18,
        "goalWithdrawals": 2,
        "boxes": 8
      },
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-1-21",
      "source": "sasquatch-1",
      "sourceNumber": 21,
      "solution": "luulllddlldlluurlddrrulurdrruurrrddllllluurlddrruldrrrruuldrdlllululdrrdrruulldllllllulldrrlddrrlluurrrlllddrrrllluurrrrrlllllddrulurrrrlllddrrudlluurr",
      "solutionPushes": 36,
      "searchNodes": 237044,
      "solutionId": 700,
      "boxSwitches": 17,
      "difficultyScore": 151,
      "rows": [
        "##### ########",
        "#   ### . $  #",
        "#   $ *.. #$ ##",
        "## $# ..* $  @#",
        " #  $ . ###   #",
        " ######## #####"
      ],
      "difficultyMetrics": {
        "pushes": 36,
        "boxSwitches": 17,
        "goalWithdrawals": 2,
        "boxes": 8
      },
      "difficulty": "expertPlus"
    },
    {
      "id": "microban-92",
      "source": "microban",
      "sourceNumber": 92,
      "solution": "uuullllllrrddllulurrrrrrllllldlldllurrrurrrddllulurddrruurrrruurrddlruullddllllddlluurrrrrlllllluluurdddrdlldllurrrurrrddllulurddrruurrrrddrruulrddlluullllddlluurrrrrrddrruulrddlddluu",
      "solutionPushes": 50,
      "searchNodes": 386,
      "rows": [
        "  ####",
        "  #  #    #####",
        "  #  #    #   #",
        "  #  ######.# #",
        "####  $    .  #",
        "#   $$# ###.# #",
        "#   #   # #   #",
        "######### #@ ##",
        "          #  #",
        "          ####"
      ],
      "difficultyMetrics": {
        "pushes": 50,
        "boxSwitches": 13,
        "goalWithdrawals": 4,
        "boxes": 3
      },
      "difficultyScore": 152,
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-7-19",
      "source": "sasquatch-7",
      "sourceNumber": 19,
      "solution": "ulullddldurduuurrdlullddrdrulluurrrdrddlruulullldddldlluuurrlldddrruuddllurdldlddrudrruluddlluururd",
      "solutionPushes": 16,
      "searchNodes": 1460,
      "boxSwitches": 15,
      "difficultyScore": 152,
      "rows": [
        "   #######",
        " ###     ##",
        " #  *..*  #",
        " # #$  $#@#",
        " #  *$$*  #",
        "##  ... ###",
        "#  $#   #",
        "# ** ####",
        "#    #",
        "######"
      ],
      "difficultyMetrics": {
        "pushes": 16,
        "boxSwitches": 15,
        "goalWithdrawals": 3,
        "boxes": 11
      },
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-2-1",
      "source": "sasquatch-2",
      "sourceNumber": 1,
      "solution": "lllldrullldrrllddrrrruurullrdddlllluurrrlllddrrrruullluuuuuulldrurdddddldrrllddrrrruuruuulluullrrddrruulrdddddlddlllluurrrurldlllddrrrruullluuuuuulldrurdddddldrrllddrrrruuruldddlllluurrrlllddrrrruullluuuuurrddrruulllrrrddduuullllulldrurdddd",
      "solutionPushes": 45,
      "searchNodes": 8950,
      "boxSwitches": 16,
      "difficultyScore": 154,
      "rows": [
        "#####",
        "#   #####",
        "# $ $ $ #",
        "### # # #",
        "  # #   #",
        " ## ### ##",
        " # .....@#",
        " # $ $   #",
        " # ### ###",
        " #     #",
        " #######"
      ],
      "difficultyMetrics": {
        "pushes": 45,
        "boxSwitches": 16,
        "goalWithdrawals": 3,
        "boxes": 5
      },
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-7-10",
      "source": "sasquatch-7",
      "sourceNumber": 10,
      "solution": "urlddrurrrdddlluuddrruuuurdlllrrrrruuulllldldururrrrdddllldddlluulluurlddrrddrruuurrruuullllddrdddrulurddldlluurlddrruruuulluurrrrdddlruuullllddrdduullrrddlluruuldrddllluurrllddrrruu",
      "solutionPushes": 23,
      "searchNodes": 7067,
      "boxSwitches": 18,
      "difficultyScore": 155,
      "rows": [
        "   #######",
        "  ##     #",
        "### .### #",
        "# $ $  # #",
        "#@*.$..  #",
        "# $ $  ###",
        "### #. #",
        "  #   ##",
        "  #####"
      ],
      "difficultyMetrics": {
        "pushes": 23,
        "boxSwitches": 18,
        "goalWithdrawals": 4,
        "boxes": 6
      },
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-4-3",
      "source": "sasquatch-4",
      "sourceNumber": 3,
      "solution": "ldddldruuuurrdrdluullddddrrrllluuuurrdrrrdlullullddddrrrdruuuruuulldlddlruururrdddlddlllluurrrluurdrlldllddrrrruurullrdddlllluurrruuurrdulldddlllddrrrruuluullldddldrrrrdrulllluurrrrruldllllddrrrrudlllluuuurrrurrdulldlllddddrrrruu",
      "solutionPushes": 37,
      "searchNodes": 8278,
      "solutionId": 588,
      "boxSwitches": 21,
      "difficultyScore": 156,
      "rows": [
        "    #####",
        " ####   #",
        " # @ $# #",
        " # #....#",
        "##$ $ $ #",
        "#  ### ##",
        "#      #",
        "#####  #",
        "    ####"
      ],
      "difficultyMetrics": {
        "pushes": 37,
        "boxSwitches": 21,
        "goalWithdrawals": 3,
        "boxes": 4
      },
      "difficulty": "expertPlus"
    },
    {
      "id": "sasquatch-6-5",
      "source": "sasquatch-6",
      "sourceNumber": 5,
      "solution": "rddrruruuulluldrrrdddldlluulluulldldddrrdruuulluldrrrrrddrruruuulllddrrdrullllllluurrdullddrrrrrrddlludrruullllrruurrdurrdlulllddddrrurudldlluullddlluuddrruulrddllllurdrrruurrddrrurulddlluuuurrdduullddrluurrrrdl",
      "solutionPushes": 36,
      "searchNodes": 6115,
      "boxSwitches": 16,
      "difficultyScore": 162,
      "rows": [
        "      ####",
        "  #####  ####",
        " ##   #  $  #",
        " # .# # #*  #",
        "## *  @  * ##",
        "#  *# # #. #",
        "#  $  #   ##",
        "####  #####",
        "   ####"
      ],
      "difficultyMetrics": {
        "pushes": 36,
        "boxSwitches": 16,
        "goalWithdrawals": 4,
        "boxes": 6
      },
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-5-4",
      "source": "sasquatch-5",
      "sourceNumber": 4,
      "solution": "uuuuuldrddddldlluluuruurrurdddduuulllddlddrdrrululuuurrrdddrdluuuulllddlludrrdrddluluruuurrrddlurdddldlluuuuurrurdddduuullldddddrrurldllurluuuldllurdrruurrrddddldlluuullurdrdddrruruuuullldduurrrddddldlluludrdrruruuuulllddlddrrlluuulluurdlddrluurdrrddldruuuldulldrrurdduld",
      "solutionPushes": 44,
      "searchNodes": 34421,
      "boxSwitches": 26,
      "rows": [
        "#### ####",
        "#  ###  #",
        "#  # $$ #",
        "# $$ #  #",
        "#    #  ##",
        "### $.#  #",
        "  #..*.@.#",
        "  ##   ###",
        "   #####"
      ],
      "difficultyMetrics": {
        "pushes": 44,
        "boxSwitches": 26,
        "goalWithdrawals": 1,
        "boxes": 6
      },
      "difficultyScore": 164,
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-4-2",
      "source": "sasquatch-4",
      "sourceNumber": 2,
      "solution": "luuuurrrlllddrrrllduluurdurrrurrdldddllulldluruurrrlllddrrdrrulllluurrrurddullllddrrrruulllllldrurrrrrddlllldlddruulurrrdrruuullllddlddruluruuld",
      "solutionPushes": 32,
      "searchNodes": 3111,
      "solutionId": 596,
      "boxSwitches": 14,
      "rows": [
        "     #####",
        "######   #",
        "#  $     #",
        "#  $### ##",
        "##.$. . .#",
        " # $#    #",
        " # @######",
        " #  #",
        " ####"
      ],
      "difficultyMetrics": {
        "pushes": 32,
        "boxSwitches": 14,
        "goalWithdrawals": 6,
        "boxes": 4
      },
      "difficultyScore": 166,
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-7-17",
      "source": "sasquatch-7",
      "sourceNumber": 17,
      "solution": "ldllddddluruulrurrrddlddrudrrulldluddlddlluruudddruluuluuruurrrdddlddlruuruuulllddlddrurlddrddluurrururrdluluuulllddllluurdldrrdrddrddluurruruuuullldduurrrdddrrdlluuuulllddllur",
      "solutionPushes": 36,
      "searchNodes": 20703,
      "boxSwitches": 22,
      "rows": [
        "     ####",
        "###### @#",
        "#  #  $ #",
        "#  $.#. #",
        "#    #. ###",
        "###$.*.$$ #",
        "  # .#.   #",
        "  ##$  ####",
        "  # $ ##",
        "  #   #",
        "  #####"
      ],
      "difficultyMetrics": {
        "pushes": 36,
        "boxSwitches": 22,
        "goalWithdrawals": 2,
        "boxes": 8
      },
      "difficultyScore": 166,
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-5-7",
      "source": "sasquatch-5",
      "sourceNumber": 7,
      "solution": "ullllllllddrururrdlrddluururrdlurrrdlullldlddrruururrdlrddluuruldllddllurlurrlddrululllruuuruulddddldrldlluurrlldrr",
      "solutionPushes": 33,
      "searchNodes": 36084,
      "boxSwitches": 18,
      "rows": [
        "   ####",
        "   #  #",
        "   #$ #",
        "   #  # ####",
        "#### ####  #",
        "#   .. ..  #",
        "#  $*. *.$@##",
        "#   #$ $#$  #",
        "#####   #   #",
        "    #########"
      ],
      "difficultyMetrics": {
        "pushes": 33,
        "boxSwitches": 18,
        "goalWithdrawals": 4,
        "boxes": 8
      },
      "difficultyScore": 175,
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-1-11",
      "source": "sasquatch-1",
      "sourceNumber": 11,
      "solution": "rrrdduullddddlluuururrrddlruulldlldddrrrrrruullduuulldlldddrruuudlulduruuldllddrrurrdddrrlluuululdrrdddrruuuulldlldruluurdrrrddddlluurlddrruurrddlruullllddrdrulluulluurrddllurdllluurlddrruruuld",
      "solutionPushes": 30,
      "searchNodes": 49352,
      "solutionId": 362,
      "boxSwitches": 20,
      "difficultyScore": 180,
      "rows": [
        "  ####",
        "###  ####",
        "#   @   ##",
        "# #. .#.###",
        "# $$$ $$$ #",
        "###.#.#.# #",
        " ##       #",
        "  ####  ###",
        "     ####"
      ],
      "difficultyMetrics": {
        "pushes": 30,
        "boxSwitches": 20,
        "goalWithdrawals": 5,
        "boxes": 6
      },
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-4-13",
      "source": "sasquatch-4",
      "sourceNumber": 13,
      "solution": "lluuuuurrrrrllllllldrurrrrrrdddddllllluuuulurdddddrrrrruuuuullldlrurrruuldrddddddllllluuuurrurrurdllldllddddrrrrruuuludrdddllllluuuurrurrddrdddrruldlllllluuuurrurrddrddrdluuuluulldllddddrrrurldlllddruluuuuurrurrddrddlldllrrurruuluulldllddrduluurruuldrdlurrrddrruldludrddllddrulur",
      "solutionPushes": 28,
      "searchNodes": 1036671,
      "solutionId": 696,
      "boxSwitches": 19,
      "difficultyScore": 181,
      "rows": [
        "      ####",
        "  #####  #",
        "###.  #$ ##",
        "#  *   .*.#",
        "# $.$ #$  #",
        "### ###   #",
        " #   ### ###",
        " #  $# $.$ #",
        " #.*.@  *  #",
        " ## $#  .###",
        "  #  #####",
        "  ####"
      ],
      "difficultyMetrics": {
        "pushes": 28,
        "boxSwitches": 19,
        "goalWithdrawals": 3,
        "boxes": 12
      },
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-4-11",
      "source": "sasquatch-4",
      "sourceNumber": 11,
      "solution": "llllldlddldruuururrdrrddddrddluuuuuulldddlddrrlluuruulddduuuruulldldddrluuururrdrrddddrddlulldllurrllururuuldduururrdddduuuuruldlldddlduuuruulldldddrluuururrdrrulllrdrrddddrddluuuuuullddldldddrrurldlluuuruururrruldlldddllddrluuruururruldldddllddrrlluuruururrddddrddluuuuuulldddllddrrrllluuruururrddddrddluudlllluuruururulddddllddrrrruuddlllluuruururrrulldldddllddrrrruuudddlllluurdlddrrurruuuuddddlldllurrrlluuuurururrdlddddrddluuuuuurul",
      "solutionPushes": 65,
      "searchNodes": 75852,
      "solutionId": 629,
      "boxSwitches": 31,
      "difficultyScore": 183,
      "rows": [
        "  ########",
        " ##.... @#",
        " #  # .  #",
        "## #  # ##",
        "#  #$ # #",
        "# $   # ##",
        "###$ ##  #",
        "  #   $$ #",
        "  #   #  #",
        "  ########"
      ],
      "difficultyMetrics": {
        "pushes": 65,
        "boxSwitches": 31,
        "goalWithdrawals": 0,
        "boxes": 5
      },
      "difficulty": "fanatic"
    },
    {
      "id": "microban-88",
      "source": "microban",
      "sourceNumber": 88,
      "solution": "rrruulduruulduruuldrddlduruuldrddddlldllurrrruulduruuldduuuuurrrdddddddldluuuuuudddddlldllurrruruuldduuuuuurrrdddddddldluuuudddlldllurrruuuuuuurrrdddddddldluuluuuurudlddrudlddruluurudlddruluuuurrurdddddduuuuulllddrudlddruuluurrurdddduuulllddrulurrurdd",
      "solutionPushes": 67,
      "searchNodes": 2122,
      "rows": [
        "     ####",
        " # ###  #",
        " # #    #",
        " # #  # #",
        " # #$ #.#",
        " # #  # # #",
        " # #$ #.# #",
        "   #  # # #",
        "####$ #.# #",
        "# @     # #",
        "#   #  ## #",
        "########"
      ],
      "difficultyMetrics": {
        "pushes": 67,
        "boxSwitches": 22,
        "goalWithdrawals": 3,
        "boxes": 3
      },
      "difficultyScore": 184,
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-5-8",
      "source": "sasquatch-5",
      "sourceNumber": 8,
      "solution": "ulllldddluururrdluldlddrruururrdlllddlluururrlldlddrruulldrurrrrrrdddldllllllluluuurldddrdrrrrrrruruuullllllurdrrrrrdddldllllllluluuuruuuruulddddrdrrrrrrrdddldllllllluluuulurddddrdrrrrrrruruuullllllddlururuldddruurrruuldrdllrrddlurul",
      "solutionPushes": 33,
      "searchNodes": 76594,
      "boxSwitches": 18,
      "rows": [
        "  ####",
        "  #  #",
        "  #$ #",
        "  #  # ####",
        "### ####  #",
        "#  .. ..  ###",
        "# $*. *.$@  #",
        "## #$ $#$ # #",
        " # #   #  # #",
        " #  ######  #",
        " ##        ##",
        "  ##########"
      ],
      "difficultyMetrics": {
        "pushes": 33,
        "boxSwitches": 18,
        "goalWithdrawals": 5,
        "boxes": 8
      },
      "difficultyScore": 187,
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-1-9",
      "source": "sasquatch-1",
      "sourceNumber": 9,
      "solution": "uullllldrrrurrdddlllrrruuulldrurrddldlddlluluuddrdrrululrddlururruruulllllldrrrurrrddldldllluuudddrruldlurrrruruullldlllurdrrurrrddldlllludrrrruruullldllurdldddrddluuuuururdllddrrrruruuldllulldddrrrrurulull",
      "solutionPushes": 40,
      "searchNodes": 66054,
      "solutionId": 67,
      "boxSwitches": 21,
      "difficultyScore": 188,
      "rows": [
        "#########",
        "#. .    #",
        "#.$. .  #",
        "## ###@ #",
        " #  $  ##",
        " # $$ ##",
        " #  $ #",
        " #  ###",
        " ####"
      ],
      "difficultyMetrics": {
        "pushes": 40,
        "boxSwitches": 21,
        "goalWithdrawals": 5,
        "boxes": 5
      },
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-4-19",
      "source": "sasquatch-4",
      "sourceNumber": 19,
      "solution": "lluuuluurrrlllddrdddddruluuuuluurrrddldlddrrruruulddrrrddllulllrrrudllldllluurrurdlllddrruudrrrurrrddlldlurrruulldlllrruuurdlddlluuurlddlduruuruulllddrdrddrruururuull",
      "solutionPushes": 32,
      "searchNodes": 442431,
      "solutionId": 661,
      "boxSwitches": 21,
      "difficultyScore": 190,
      "rows": [
        " #########",
        " #   *   #",
        " # ## ## #",
        " #  * *  #",
        "###  #  ###",
        "#  .$#$.  #",
        "# #  @  # #",
        "#  .$#$.  #",
        "###  #  ###",
        "  #######"
      ],
      "difficultyMetrics": {
        "pushes": 32,
        "boxSwitches": 21,
        "goalWithdrawals": 5,
        "boxes": 7
      },
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-7-2",
      "source": "sasquatch-7",
      "sourceNumber": 2,
      "solution": "ulldduuluurrdullddrddrruullddllurdrrruulldurrddlddllurlluurduludrruruuurrdluldllddrrrddlluuluurrdullddrddrruuluullddlddrluullddrluurrruuld",
      "solutionPushes": 21,
      "searchNodes": 5758,
      "boxSwitches": 15,
      "rows": [
        "     #####",
        "  ####   #",
        "  #   $  #",
        "###  #$###",
        "#  * .  #",
        "# * * #@#",
        "#  * *  #",
        "### * .##",
        "  ##   #",
        "   #####"
      ],
      "difficultyMetrics": {
        "pushes": 21,
        "boxSwitches": 15,
        "goalWithdrawals": 7,
        "boxes": 8
      },
      "difficultyScore": 190,
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-1-7",
      "source": "sasquatch-1",
      "sourceNumber": 7,
      "solution": "ulldrrrrrrrllllllldduulldrurrrrrrrrruururrrddldllrdrruudrrulldlllluururrrdullldlddlruururrrddrdlllrruuullldlddllllrrrruururrrdddllurdllluururrrddrdlllurruullldlddllddlldllldlluruulururrddrurrrddlldlllrrrurruurlllllulldrrrrrrddlldllldluuulururrddlruulldrdrrurrrddlldlllluururrrrlldllllurrrrrlluurdldr",
      "solutionPushes": 62,
      "searchNodes": 1187585,
      "solutionId": 699,
      "boxSwitches": 29,
      "difficultyScore": 191,
      "rows": [
        "           ######",
        "    ####  ##    #",
        "  ###  #  #  ## ###",
        "###    #### #   $ #",
        "#  $ @ ...*..  $  #",
        "# $ $  ## ###   ###",
        "### ###   # #####",
        " #      ###",
        " #   ####",
        " #####"
      ],
      "difficultyMetrics": {
        "pushes": 62,
        "boxSwitches": 29,
        "goalWithdrawals": 1,
        "boxes": 6
      },
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-1-13",
      "source": "sasquatch-1",
      "sourceNumber": 13,
      "solution": "uluurrrrdrddddllrdlrddrdrddluuullullllluuddrrrdddrrrudllluuurrdruuuldrddddllluuurrllllluurdldrrrdddrrrurrddlulllluuurldddrrruuudddllluuurruurruuuulullllddlddddullurdddrrrdddrrruuluuurruuuulullllddlddldddrrrrldddrrruuludrddrruldlllluuulluluurdlddrrruurrllddllluurdldrrrrldddrrrudludlluuurulur",
      "solutionPushes": 46,
      "searchNodes": 14247553,
      "solutionId": 703,
      "boxSwitches": 24,
      "difficultyScore": 192,
      "rows": [
        "   #######",
        " ###     ##",
        " #   ###  #",
        " #      # #",
        "###$#@  # #",
        "#   ##### #",
        "#   #  *. #",
        "##$$#  *.##",
        " #     *..#",
        " #### #...##",
        "    # #$$$ #",
        "    #   $  #",
        "    #####  #",
        "        ####"
      ],
      "difficultyMetrics": {
        "pushes": 46,
        "boxSwitches": 24,
        "goalWithdrawals": 2,
        "boxes": 10
      },
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-4-20",
      "source": "sasquatch-4",
      "sourceNumber": 20,
      "solution": "uuluuddrruuddlddrruldludlurruuuluulldldddldllludrrruruuururrrdduullldrlldddldlurruuurrrdrduluurddulllldddldllluruuludduuluurdrdurdullldrddrddluuuuddddrrruldlurrruuurrdulldddlllluuuluurddduurrdluld",
      "solutionPushes": 36,
      "searchNodes": 1352781,
      "solutionId": 694,
      "boxSwitches": 24,
      "difficultyScore": 192,
      "rows": [
        "####",
        "#  #########",
        "#    ##    #",
        "# $$$#     #",
        "##...# #$$$#",
        " #...# #...#",
        " #$$$  #...##",
        " #    ##$$$ #",
        " ####### @  #",
        "       ######"
      ],
      "difficultyMetrics": {
        "pushes": 36,
        "boxSwitches": 24,
        "goalWithdrawals": 2,
        "boxes": 12
      },
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-7-6",
      "source": "sasquatch-7",
      "sourceNumber": 6,
      "solution": "llluururrrulddrullldrrurrruluulldduurrdddlldlluurlddrrurruuullddrdrullllddlddrrrrruuddllllluurrrruulllluurdldrddrrruululldrlddruuddrrulrurrdlduldllllddrulurrrllddrrrruuddlllluurrruulrrrdld",
      "solutionPushes": 36,
      "searchNodes": 48569,
      "boxSwitches": 23,
      "rows": [
        "#########",
        "#  #   #",
        "#.$*$#.##",
        "#  .$ $ #",
        "## ...  #",
        "# $  $ ##",
        "# $###.#",
        "#   @  ##",
        "#########"
      ],
      "difficultyMetrics": {
        "pushes": 36,
        "boxSwitches": 23,
        "goalWithdrawals": 4,
        "boxes": 8
      },
      "difficultyScore": 193,
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-4-29",
      "source": "sasquatch-4",
      "sourceNumber": 29,
      "solution": "drruurrruuurldddlllddllddrrrrrdrrruruuuuuuuulluldrrrddddddddldlllullllluurruurrrrruuldldlllddllddrrrrrdrrruruuuuuuuullldurrrddddddddldlllullllluurrrrrrrudllllluurrrurruuddlldlllddrruldrrrruuullddldruuurrddlldlluurlddrrulrrruulldlddllllddrrrrrdrrruruuuuuuuullrrddddddddldlllullllluurrrruururrddlldlllllddrrrrrdrrruruuuuuuuulldlduldurrurrddddddddldlllullllluurrrrrurruuudddlldlllllddrrrrrdrrruruuuuuuuullulddurrrddddddddldlllullllluurrrrrurruuuuddddlldlllllddrrrrrdrrruruuuuuuuulldllddduuurrddddddluruuuuuuuld",
      "solutionPushes": 31,
      "searchNodes": 721741,
      "solutionId": 688,
      "boxSwitches": 24,
      "difficultyScore": 196,
      "rows": [
        " # ## ####",
        "## #  #  ###",
        "   # ##$   #",
        "#### # * # #",
        "#    # * # #",
        "  #### * # #",
        "###    . # #",
        "#@#.****$# #",
        "#        # #",
        "# #####  # #",
        "#      ##  #",
        "######    ##",
        "     ######"
      ],
      "difficultyMetrics": {
        "pushes": 31,
        "boxSwitches": 24,
        "goalWithdrawals": 4,
        "boxes": 9
      },
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-7-14",
      "source": "sasquatch-7",
      "sourceNumber": 14,
      "solution": "lluulrddllullluurrrdrrddlldddrrudlluulurrruullduulllddrrddrddrruuurruullrrddlldddlluulurlulluurrrddlddrddrruuurruulllrrrddrruullllrrddlldddlluuluurdrrdddlluuddrruuullullluurrrdddrrrruulllrrrddllllullluurrrdrrrrddlldddlluuludrddrruuullrrrruurrddllllrruulllldduurrrrddlllrrruulllldlduruulllddrluurrrdrrrrddlllluurrdurrddlll",
      "solutionPushes": 48,
      "searchNodes": 24405,
      "boxSwitches": 29,
      "difficultyScore": 196,
      "rows": [
        "######",
        "#    #######",
        "# ## $ $ $ #",
        "#  . # # # #",
        "###..$  @  #",
        "  #..# #####",
        "  ## #$#",
        "   #   #",
        "   #####"
      ],
      "difficultyMetrics": {
        "pushes": 48,
        "boxSwitches": 29,
        "goalWithdrawals": 3,
        "boxes": 5
      },
      "difficulty": "fanatic"
    },
    {
      "id": "microban-83",
      "source": "microban",
      "sourceNumber": 83,
      "solution": "urruuuululldddddrrruulurdddllluuurrdrdddlldluuudrrruululluurrduldrrddddllluuudddrrruuuulullldrddddrrrrdluuulurdddllluuurrlluurdurdrdduulllddddrrrdlulluuuurrrdddduulurdddllluuurrluurdrdduulldrlldddrrrrdlullluuurrdrdululldddrrrlllddrulurluuurrdrdddlruuuluurddddldruuuulllddddrlur",
      "solutionPushes": 53,
      "searchNodes": 829,
      "rows": [
        "######",
        "#    ##",
        "# $ $ ##",
        "## $$  #",
        " # #   #",
        " # ## ##",
        " #  . .#",
        " # @. .#",
        " #  ####",
        " ####"
      ],
      "difficultyMetrics": {
        "pushes": 53,
        "boxSwitches": 30,
        "goalWithdrawals": 3,
        "boxes": 4
      },
      "difficultyScore": 199,
      "difficulty": "fanatic"
    },
    {
      "id": "sasquatch-4-4",
      "source": "sasquatch-4",
      "sourceNumber": 4,
      "solution": "uruulduulllddrluurrrddrddlldludrddlulrruuldurrruulduuulllddrrlluurrrdrddddlluludrdddllurdruurruuuululllddrdddrrruuludrddllluuurudldddrrruuuldrddllddllururrruuuululrdddrddlllddlllurdrruurrudllddrudlllurruuuuluur",
      "solutionPushes": 29,
      "searchNodes": 40405,
      "solutionId": 660,
      "boxSwitches": 24,
      "difficultyScore": 201,
      "rows": [
        "  ######",
        "  #  . ##",
        "  # #*  #",
        "  # $.$ #",
        "  ## *. #",
        " ## $.@ #",
        "## # .$ #",
        "#  $$.# #",
        "#      ##",
        "########"
      ],
      "difficultyMetrics": {
        "pushes": 29,
        "boxSwitches": 24,
        "goalWithdrawals": 5,
        "boxes": 8
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-5-12",
      "source": "sasquatch-5",
      "sourceNumber": 12,
      "solution": "lldrurrdullddddlddrrlluurrduluuuurrddldldduururuulldrddlddrudrruluddlluuudddrruulrddlluurrdrdddluruulullddlddruluururrdrddllrruulduulldruuuurrdluldddrduluuulldr",
      "solutionPushes": 27,
      "searchNodes": 45017,
      "boxSwitches": 22,
      "rows": [
        "#######",
        "#  @  #",
        "# $.$ #",
        "##.$.##",
        "## $ ##",
        "# $.$ #",
        "# .$. #",
        "# .$. #",
        "#  #  #",
        "#######"
      ],
      "difficultyMetrics": {
        "pushes": 27,
        "boxSwitches": 22,
        "goalWithdrawals": 6,
        "boxes": 8
      },
      "difficultyScore": 205,
      "difficulty": "master"
    },
    {
      "id": "sasquatch-6-21",
      "source": "sasquatch-6",
      "sourceNumber": 21,
      "solution": "rdrrulldldlddrurudlluurdulullldrdrluurrdlrrdrulluurduuuldldurrddlurddrruulrddllurdddluruulldldruurrdddldlurruuulldrd",
      "solutionPushes": 22,
      "searchNodes": 23477,
      "boxSwitches": 20,
      "rows": [
        "##########",
        "# ##  #  #",
        "# # * ####",
        "###$ .$ ##",
        "#  . @ * #",
        "# *   .  #",
        "## $. $###",
        "#### * # #",
        "#  #  ## #",
        "##########"
      ],
      "difficultyMetrics": {
        "pushes": 22,
        "boxSwitches": 20,
        "goalWithdrawals": 7,
        "boxes": 8
      },
      "difficultyScore": 206,
      "difficulty": "master"
    },
    {
      "id": "sasquatch-3-5",
      "source": "sasquatch-3",
      "sourceNumber": 5,
      "solution": "lulrdrrddldldllullllllluluuuururrrrrrrrdulllllllldlddddrdrrrrrrrdrrururuulldllllulllrrrdrrulllullddrrulrrrdrrrulllrrrrrddldldllullllllluluuuururrrrrrrrddrddllulurdlllurrddrrrulllullddrluurrdlrrrrrrddldldllullllllluluuuururrrrrrrrddrddllulurddrrullrrrrddldldllullllllluluuuururrrrrrrrddldrruluulllllllldlddddrdrrrrrrrdrruluuluullddrluurrdldruurrdlluruulllllllldlddddrdrrrrrrrdrruluuruldddrruruulrddldlluuuuuulllllllldlddddrdrrrrrrrdruuu",
      "solutionPushes": 53,
      "searchNodes": 929405,
      "solutionId": 687,
      "boxSwitches": 29,
      "difficultyScore": 209,
      "rows": [
        " ###########",
        "##         #",
        "#  #######$##",
        "# #       $ ###",
        "# #...***.*.@ #",
        "# #       $ # #",
        "#  #######$#  #",
        "##        $  ##",
        " ########   ##",
        "        #####"
      ],
      "difficultyMetrics": {
        "pushes": 53,
        "boxSwitches": 29,
        "goalWithdrawals": 2,
        "boxes": 9
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-5-3",
      "source": "sasquatch-5",
      "sourceNumber": 3,
      "solution": "lluuddrruldluruulluuurrddddullulldddrdrluluuurrdrrddluruuuullddlldddrdrdruurrdluuuuuulldddluruurrdddllrrddluruuuullddlllddrdrdrdruudlluluuddrdrruruuuuulldddluruurrdddllrrdddlllululuurrllddruddrdrruruulllrrrdddlllululuurdrrrrddlurullulrdrruuulld",
      "solutionPushes": 41,
      "searchNodes": 323,
      "boxSwitches": 26,
      "difficultyScore": 211,
      "rows": [
        "   #####",
        "   #   #",
        "#### # #",
        "# . .# #",
        "#  .   #",
        "# .## $##",
        "##  #$$ #",
        " ##   $@#",
        "  ##  ###",
        "   ####"
      ],
      "difficultyMetrics": {
        "pushes": 41,
        "boxSwitches": 26,
        "goalWithdrawals": 6,
        "boxes": 4
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-1-22",
      "source": "sasquatch-1",
      "sourceNumber": 22,
      "solution": "rrddrruldlluurdrddrrrddlurulullddlllulrdrrrrluuulldrurrdrdrddluludrruldlllllululldrdrrrrrrlllllldddrrrrrrddrdrruluurrruuuuuullllllrrddduuullldlurrrrdddllurdlludlllldddrrrrrrddrluulllllluuuuurdlddddrrrrrrddrdrruluurrruuuuuulllllldulllur",
      "solutionPushes": 36,
      "searchNodes": 3173373,
      "solutionId": 702,
      "boxSwitches": 22,
      "difficultyScore": 214,
      "rows": [
        "   ##### ####",
        "   #@ .###  ###",
        "####  $$ $    #",
        "#   # . . ##  #",
        "#  $ # . . ## #",
        "## .  $ $$  # #",
        " # #  ###.  # #",
        " # #### ##### #",
        " #       #    #",
        " ####### # ####",
        "       # .$ #",
        "     ####   #",
        "     ## #####",
        "      ###"
      ],
      "difficultyMetrics": {
        "pushes": 36,
        "boxSwitches": 22,
        "goalWithdrawals": 6,
        "boxes": 8
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-4-37",
      "source": "sasquatch-4",
      "sourceNumber": 37,
      "solution": "dldlddrurruurdrruluullrrddlruulluruuldlldduurrdrdrdddllddrulururrdluuuluulllddlulldrrlddrrlddrululldruuuurruuldrrrrddrrul",
      "solutionPushes": 30,
      "searchNodes": 19274,
      "boxSwitches": 22,
      "rows": [
        "   ## ##",
        " ##  #  ##",
        " ##     ##",
        "#  *$#$*  #",
        "#  $...$  #",
        " # #.@.# #",
        "#  $...$  #",
        "#  *$#$*  #",
        " ##     ##",
        " ##  #  ##",
        "   ## ##"
      ],
      "difficultyMetrics": {
        "pushes": 30,
        "boxSwitches": 22,
        "goalWithdrawals": 5,
        "boxes": 12
      },
      "difficultyScore": 216,
      "difficulty": "master"
    },
    {
      "id": "microban-36",
      "source": "microban",
      "sourceNumber": 36,
      "solution": "dllllllllllluurdldrrrrulldlluurdldrrurrdrrulllldrllluurdldrurrdrullldrurrrrdrrullllllrrrrrrdrrurrdlulldllullldrullldrurrrrdrrullllllrrdrullldrurrdrullldrllllluurdldrrrurrdlurrrdlurrrdlurrrdlulllllllldlluurdrrrdlurrrdlurrrdlurrrdlulllldlurrrdlurrrdlulldlurrrdll",
      "solutionPushes": 65,
      "searchNodes": 19226,
      "rows": [
        "####",
        "#  ############",
        "# $ $ $ $ $ @ #",
        "# .....       #",
        "###############"
      ],
      "difficultyMetrics": {
        "pushes": 65,
        "boxSwitches": 32,
        "goalWithdrawals": 3,
        "boxes": 5
      },
      "difficultyScore": 222,
      "difficulty": "master"
    },
    {
      "id": "sasquatch-6-6",
      "source": "sasquatch-6",
      "sourceNumber": 6,
      "solution": "ulluullddrlldllrrurrrllldllulldrrurrruullldurrrddllluurrrrrddlrrddlludrruuluulllllddrrdrullluurrrrrddlruullllldddrrulluurrrrrddllrrrddlludrruuluulllllddrdrruldlluuurrrrrddllrrrdrruldldllulurdlllluuurrrdullldddllur",
      "solutionPushes": 34,
      "searchNodes": 7511,
      "boxSwitches": 25,
      "difficultyScore": 223,
      "rows": [
        "  ########",
        "  #      #",
        "### ## # ####",
        "#  *.** .*  #",
        "#  $   $# @ #",
        "#######   ###",
        "      #####"
      ],
      "difficultyMetrics": {
        "pushes": 34,
        "boxSwitches": 25,
        "goalWithdrawals": 7,
        "boxes": 6
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-3-7",
      "source": "sasquatch-3",
      "sourceNumber": 7,
      "solution": "uuurrudlddrurrdrrdddllldllurdrurrruuullullluurrdullddrddddrrrddrrruruuuuuuulullllulldurrdrrrrdrdddddddldllluuruuullulrdrrdddlllddlururrruuulldlrurrdddllludrrruuulldrurdduulluluuluurrdrrrrdrdddddddldllluuurrdluuulluluuluurrdrrrrdrdddddddldlludrruruuuuuuulullllullddrddldlluuurdldr",
      "solutionPushes": 26,
      "searchNodes": 19271,
      "boxSwitches": 19,
      "rows": [
        "  #####",
        "  #   #####",
        "### #     ##",
        "#  * ####  #",
        "#  * ##  # #",
        "#  *  ** # #",
        "#   #    # #",
        "#@#** * ## #",
        "###  #$  # #",
        " # .$ .* # #",
        " #   #  #  #",
        " ##  #    ##",
        "  #########"
      ],
      "difficultyMetrics": {
        "pushes": 26,
        "boxSwitches": 19,
        "goalWithdrawals": 9,
        "boxes": 11
      },
      "difficultyScore": 246,
      "difficulty": "master"
    },
    {
      "id": "sasquatch-4-26",
      "source": "sasquatch-4",
      "sourceNumber": 26,
      "solution": "rddurrllulldddlllddrrrrurdllllluurrruuurrdddrduuurrlldddduuuurrdddlruuulllulldddlllddrrrrrrurruuulldlddrrrduuuururrdllllrddddduuuuulldlddldlllluurrruuurrddurrrdddddrddluuuuuuddlllldlllluurrruuurrddduuulldddlllddrrrruruuurrrrurrdllllldlddldlllluurrruuurrdrrrdddlldlllrrrurruuullddldldlllrrrururuurrdddlldllrruulduruuldrddlldllrrurruuldrddlllrrruuldldlddrrruuddllluururuuurrrdddlldllrruuldrdlurrruuldululddrrrdlulduld",
      "solutionPushes": 75,
      "searchNodes": 485702,
      "solutionId": 666,
      "boxSwitches": 38,
      "difficultyScore": 248,
      "rows": [
        "   ##### #####",
        "   # @ ###   #",
        "   # # $     #",
        "#### #$ $ ####",
        "#    # $ $#",
        "# ### $ $ #",
        "#.......# ##",
        "#### ## #  #",
        "   #    #  #",
        "   ######  #",
        "        ####"
      ],
      "difficultyMetrics": {
        "pushes": 75,
        "boxSwitches": 38,
        "goalWithdrawals": 2,
        "boxes": 7
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-4-9",
      "source": "sasquatch-4",
      "sourceNumber": 9,
      "solution": "rrdldddrdrruuuruuldrdddldlluuluurdlddrdrruuruuldurrrdddrddluuruuluurdllldddldlldlurrruruuurrrdullldddldllludrrruruuurrdrduullldddldlluluddrrruruuurrdrddluruullldddlddrullluluudddrrrruuudddllluluurdlddrrruruuldrddlllluuuruulldrddddrrrruuulurddddlllluurdldrrrdruuuldrdllldluudrrruuuurrrlllddddlluuuluurddddluddrrrdruuluuurrrurddullllddddlluuluruulldrddddrrruuuurrrrdduullllddddlluuuluurddddldrrrdruluuuurrrrddlurullluldrrrdddddrruldluuuruuldullldurrrdrdduuulllldduurrrdrddluuddddrruldluruuuulllulddurrrddrddluuurullluld",
      "solutionPushes": 90,
      "searchNodes": 275073,
      "solutionId": 646,
      "boxSwitches": 38,
      "difficultyScore": 258,
      "rows": [
        "###########",
        "#@  #  #  #",
        "#  $#$   $#",
        "##  #..#  #",
        " #  #..#  #",
        " #  #..#  ##",
        " #$   $#$  #",
        " #  #  #   #",
        " ###########"
      ],
      "difficultyMetrics": {
        "pushes": 90,
        "boxSwitches": 38,
        "goalWithdrawals": 2,
        "boxes": 6
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-1-4",
      "source": "sasquatch-1",
      "sourceNumber": 4,
      "solution": "dddlludrullllluurrdullddrruulllldrurrrddlldlurrruuldrddldduururrlldlddrdlluldurruuruulddddrdlllullddrulurrdrruuuulldruruuldrddddrdlllullddrulurdrrruuullururddddrdlllrruuuurrrdrrulllldldddllluldldrurrrruuuluurddddrdllllullddrurrrruuuurrrrruulldurrddllllulddddrdluuuurrrrruldllldldddlllldlurrrrruuuurrrruuldrdlllulddddrdluuuuuullldrrurdlddrdddlllrrruuuluurddddrdlll",
      "solutionPushes": 95,
      "searchNodes": 4839852,
      "solutionId": 524,
      "boxSwitches": 24,
      "difficultyScore": 260,
      "rows": [
        "  ###########",
        " ##     #  @#",
        "### $ $$#   #",
        "# ##$    $$ #",
        "#  #  $ #   #",
        "###### ######",
        "#.. ..$ #*##",
        "# ..    ###",
        "#  ..#####",
        "#########"
      ],
      "difficultyMetrics": {
        "pushes": 95,
        "boxSwitches": 24,
        "goalWithdrawals": 4,
        "boxes": 9
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-4-12",
      "source": "sasquatch-4",
      "sourceNumber": 12,
      "solution": "uuuluuullullddldlddrluururrdldddddrddlluruuuulluururuurrdrrdddrddludrddlulrruuldldlldluuulluururrdluuurrdrrdddrddlldllluuuuuuddddddrrrurruuluuulluullldrurrddrrdddrdddllurruuldrddlllrrruulduuuuulluullddddrrdrlululuuurrddrrdddrddlldlldluuuuuudrrdrrrdddllllrrurruuldrddlllldluuddddruluuuuddrrrrruuldldllluulluururrdrdrrddrdllllrruruullululldlddrrdduulluururrdlddlluururrdrdrrdddlllludrrruruullululdrrdrruuulluulldduurrdluld",
      "solutionPushes": 66,
      "searchNodes": 168742,
      "solutionId": 650,
      "boxSwitches": 34,
      "difficultyScore": 282,
      "rows": [
        " ######",
        " #    #",
        " #    ###",
        " ##*#   #",
        "## . ## #",
        "#     # ##",
        "# #.#  $ #",
        "# $.###$ #",
        "### ##   #",
        "  #   $$@#",
        " ##..##  #",
        " #   #####",
        " #   #",
        " #####"
      ],
      "difficultyMetrics": {
        "pushes": 66,
        "boxSwitches": 34,
        "goalWithdrawals": 7,
        "boxes": 6
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-1-16",
      "source": "sasquatch-1",
      "sourceNumber": 16,
      "solution": "luluulrdddlrdduullrrdddrllddrururldlluruuulldrurduuuululldrdrurdulllldrurrdrdrddlduruuluullldrurrddrdluuulldrurdulluurdldrdrdrddluuddllurdrudllllurrrdrddlddruuuddrruldldddrdrrululdludrrrrulldlluuluruddddrruldludrrddlurulululuurdduurrdluldurrrrdrrulldlruldlruldlrul",
      "solutionPushes": 68,
      "searchNodes": 54266972,
      "solutionId": 705,
      "boxSwitches": 45,
      "difficultyScore": 294,
      "rows": [
        "  ######",
        " ## #  ###",
        "## #   # ##",
        "# #   $.# #",
        "##  $ $.# #",
        "# #####. ##",
        "#     $. @#",
        "#     $. ####",
        "### # #*# # ###",
        "  #### .$     #",
        "    #  .$     #",
        "    ## .##### #",
        "    # #.$ $  ##",
        "    # #.$   # #",
        "    ## #   # ##",
        "     ###  # ##",
        "       ######"
      ],
      "difficultyMetrics": {
        "pushes": 68,
        "boxSwitches": 45,
        "goalWithdrawals": 3,
        "boxes": 11
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-3-1",
      "source": "sasquatch-3",
      "sourceNumber": 1,
      "solution": "lurdrddddddllddrrudllullurdrdrruuuuddddlluluuuuurudldddddrdrruuuuruulddddllrruuuuuululldrddlddddrrruuuuuurullrdddddddllluuuuruururdlllurrdrdduullddlddruuudddlddrrruuruuluululldrddddlddrrruuruuluurullrdddrddlddllddrululldrruluuuuruururrdlddrddlddlldlluruuuuruururdllddddldddrdrrudlluluuuuuruulur",
      "solutionPushes": 42,
      "searchNodes": 177895,
      "solutionId": 640,
      "boxSwitches": 23,
      "difficultyScore": 297,
      "rows": [
        " #######",
        " #  *  #",
        " #  @  #",
        " ##$#.##",
        " #  #  #",
        " # $#. #",
        " #  #  #",
        "## ## ##",
        "#  * * #",
        "#   *  #",
        "###   ##",
        "  #####"
      ],
      "difficultyMetrics": {
        "pushes": 42,
        "boxSwitches": 23,
        "goalWithdrawals": 13,
        "boxes": 6
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-1-3",
      "source": "sasquatch-1",
      "sourceNumber": 3,
      "solution": "luuuuurrrdddrrrululrddlluurulllulddddddrdllullddrulurrdruuuluruurrrdddruruldlurullluldddldruuurrrdddrrrrrullldluruldlurulllulddddddrdllullddrurullrrruuuuurrrddrrrrullldlurulllulddddddrdllullddrulurrrrluuuuurrrdrrrulllllulddddddrdllllurrruuuuurrrrrrurddlddrruldluurullllllulddddddrdllullddrururuuuuurrrrrrururuuldddddlddrruldluurullllllulddddddrdllldlurruruuuuurrrrrruruulddrdllllllulddddddrdlllruruuuuurrrrrrrruuluurrdluldddrdlllllllulddddddrdlluruuuuurrrddrrrrruuuuluurrdluldddrdlllllllulddddddrdlrrrulll",
      "solutionPushes": 195,
      "searchNodes": 0,
      "solutionId": 62,
      "boxSwitches": 12,
      "difficultyScore": 305,
      "rows": [
        "           #####",
        "          ##   #",
        "          #    #",
        "    ####  # $ ##",
        "    #  ####$ $#",
        "    #     $ $ #",
        "   ## ## $ $ $#",
        "   #  .#  $ $ #",
        "   #  .#      #",
        "##### #########",
        "#.... @  #",
        "#....    #",
        "##  ######",
        " ####"
      ],
      "difficultyMetrics": {
        "pushes": 195,
        "boxSwitches": 12,
        "goalWithdrawals": 2,
        "boxes": 10
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-4-23",
      "source": "sasquatch-4",
      "sourceNumber": 23,
      "solution": "ululuuruuldrdduullllrrrrddddrdluuuuulllldlrurrrrdddddlruuuuulllldldlddrddrrrurruuulludrdrddlldllluuluurururrrurdlllldldlddrrrdrdlurrruuulluurrddduuuldrdddrdllruuuuulllldldldllurururrlldlddrurururrdrruuldllldldllururrrrrlllllddrururrddrluulldldlddrddluurrrddlruullluluurrrurrddrdrddllrruululuurdrdduulullldlllddrdrrrdullluluurrrurrdrrdddrdluuuulullldlllddrddddruluuuluurrrurrdrrddddllrruuuulldrurdddrdllruuuulullldlllddrdddrrrudllluuuluurrrurrddrdrddllrruuuuluurdddduuulllldllurdllddrulururrllddrururrddrdrduuuuuldrddddrdllruuuuulllldllurrrrrdldrurduluurdlddrdduuluurdlddrdrdluuluurdduuulllldldlddrduluuuurrrrddrdrduuuulllldldlddddrr",
      "solutionPushes": 98,
      "searchNodes": 16161761,
      "solutionId": 673,
      "boxSwitches": 56,
      "difficultyScore": 318,
      "rows": [
        "       ####",
        "  ######  #",
        " ##  $  $ #",
        "##  $ #$  #",
        "#  $ #   $#",
        "#   # ##  ##",
        "###$  ..#  #",
        "  #  #*...@#",
        "  #   ..####",
        "  #  ####",
        "  ####"
      ],
      "difficultyMetrics": {
        "pushes": 98,
        "boxSwitches": 56,
        "goalWithdrawals": 1,
        "boxes": 8
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-4-6",
      "source": "sasquatch-4",
      "sourceNumber": 6,
      "solution": "drrrrruuuurrdllrrrrrddlurullldrulullddrlddruluuullddrluurrddduuurrdlulllddrrdruddlllrruulluurrddrddllllrrrruuluurrdldddllllllluuuuullldddddrdruuuudddrrrrrrrruulduruuldrdddllllllluuuuullldddddrdrurrrrrrruruuldrddllllluulluluddrddludrrrrrrrruuldrdlllllulldllluuuuurrurddullldddddrruuddlluuuuurrdrddludrrdrdluulldrurrddlluuuuullldddddrdruudrrrrrrruuurrrdlulldddlllluulluludrdddrrrrrruuurrdluldrddlllllllllluuuuurrddrdddrrrrrrruuldrdllruullurdrddllllllrrrrrruuluurddrddllllllluluruuluurdllldddddrdruruuludrddllluuuuurrrdullldddddrrrrrrrrrruuldrdllllluullluuddrddludlluuuuurrlldddddrrururrddlruulldluddlluuuuurrdrduluurdllldddddrruuurdlddlluuuuurrrdullldddddrruuuuddddlluuuuurrdddrrrddllrrrrrruuurrrrrdllulldddllllluullluurdululldddddrdrurrrrrrruuurrrdlluldrddlllllllllluuuuurrurdllldddddrruuuuddddlluuuuurrdddrlddrrrrrrrruuldrdlllllllluuuuulldddddrdrurrruulrddllluuudddrrruulluludrdrrddllluuudddrrurullrddlluurrdldlu",
      "solutionPushes": 138,
      "searchNodes": 3235144,
      "solutionId": 658,
      "boxSwitches": 67,
      "difficultyScore": 405,
      "rows": [
        "  ####",
        "###  #",
        "#  ..# #######",
        "# #..# #     ####",
        "# #. ###   $    #",
        "# #.   # $ $ $$ #",
        "# #  @ ### $##  #",
        "#           #####",
        "##  #########",
        " ####"
      ],
      "difficultyMetrics": {
        "pushes": 138,
        "boxSwitches": 67,
        "goalWithdrawals": 3,
        "boxes": 6
      },
      "difficulty": "master"
    },
    {
      "id": "sasquatch-4-27",
      "source": "sasquatch-4",
      "sourceNumber": 27,
      "solution": "ullllldurrdurrrddludrrrdddddrdlllrruuuuuulululddrrrddddddllluuuurudldlllullluurruurrdrrlluurdrddrluulldrulllddllddrrrdrrurrurldldddlduruuululuuddrddrdddddlluruuruuululuururrdulldlddrddrdddlddruluuruuululuururrdrdrdulululldlddrddrddlddruuuuluuluururrdrdrdddddrdlllrruuuuuulululldrllddrddllullluurrrluurrdrrdrlullullddllddrrrdrruululluurrurdrddrddlrurluluurdrdrdddddrdluuuuuulululllllddllddrrrdrrrddlddruuuulllullluurruurrrrdrrdrddddddllrruuuuuulululllllddllddrrrdrrrddlddrurrruuuuuululldrdrluurdrdddddrdlllluldrddllururrrruuuuuulldrurddduuulululllllddrrurrdrdrrddddrdllllulddurrrruuuuuullluurdrddrdddddlllldldruurrrruuuuuululllldlluurrdrrdrurdulllluurdrddrdrurddddduuuuulululllddllllddrrrdrrrdulllullluurrrrurrdrdrrddddrdluuuuuullluurdldrdrrdddddllrruuuuulluurdrddddddlllrrruuuuuulldrurdulullllddrdulullllurdrrruulldldlddrrrdrrllullluurrrlllddrrrdrruuluudlluurrurdrddrdrrdduuululullldrrdrdrrddddrdluuuuuullluurdldrdrrdddddlruuuuulldlrurrdddddllrruuuuulluurdldrurdddddrdluuuuuulullllddrdrdululullllddrrrdrrurrurrdddddl",
      "solutionPushes": 151,
      "searchNodes": 19488455,
      "solutionId": 680,
      "boxSwitches": 74,
      "difficultyScore": 473,
      "rows": [
        "    ####",
        "  ###  ###",
        "###      ##",
        "# $$#$$$@ ##",
        "#     #    #",
        "# ###  #$$$#",
        "#    #   # #",
        "####   .## #",
        "   ####.## ##",
        "    ## .##  #",
        "    ##...   #",
        "    #  .#####",
        "    #  .#",
        "    #####"
      ],
      "difficultyMetrics": {
        "pushes": 151,
        "boxSwitches": 74,
        "goalWithdrawals": 5,
        "boxes": 8
      },
      "difficulty": "master"
    }
  ]
};
