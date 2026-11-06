#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
int main(void) {
 FILE *f=fopen("/disc/test.bin", "rb"); assert(f);
 unsigned char data[4096];
 const long positions[]={0,1048570,2000000,12345,2999990};
 for(int i=0;i<5;i++){
  assert(fseek(f,positions[i],SEEK_SET)==0);
  size_t want=i==4?10:sizeof(data);
  assert(fread(data,1,want,f)==want);
  for(size_t j=0;j<want;j++) if(data[j]!=(unsigned char)((positions[i]+j)*17)){printf("Mismatch i=%d j=%zu got=%u want=%u\n",i,j,data[j],(unsigned char)((positions[i]+j)*17));abort();}
 }
 assert(fread(data,1,1,f)==0); fclose(f); puts("DISC_FS_PASSED");
}
