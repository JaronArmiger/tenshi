#ifndef TWI_STATE_MACHINE_H_
#define TWI_STATE_MACHINE_H_
// This file contains code for the I2C hardware.

extern unsigned long last_i2c_update;

// Called to configure I2C hardware on startup.
extern void init_i2c(unsigned char addr);

#endif  // TWI_STATE_MACHINE_H_
